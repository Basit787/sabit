import type { IncomingMessage, ServerResponse } from "node:http";
import {
  All,
  type CanActivate,
  Controller,
  Delete,
  type DynamicModule,
  Get,
  Head,
  Inject,
  type ModuleMetadata,
  type NestInterceptor,
  Options,
  Patch,
  Post,
  type Provider,
  Put,
  Req,
  Res,
  SetMetadata,
  type Type,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import {
  createContext,
  executeRoute,
  fallbackMethods,
  formatPaths,
  type HttpMethod,
  headersFromRecord,
  type PathDialect,
  type RawParams,
  type RawPlatform,
  type ResolvedRoute,
  type RouteContext,
  RouteDefinitionError,
  type RouteProblem,
} from "@sabit/router";
import { hasNodeBody, readNodeText, writeNodeResponse } from "@sabit/router/node";

/** Path syntax of Nest 11+ on Express 5 (path-to-regexp v8). */
export const nestDialect: PathDialect = {
  param: (name) => `:${name}`,
  catchAll: (name) => `*${name}`,
};

type NestRequest = IncomingMessage & { body?: unknown; params?: RawParams; originalUrl?: string };

export interface NestPlatform extends RawPlatform {
  readonly framework: "nest";
  readonly request: NestRequest;
  readonly response: ServerResponse;
  readonly moduleRef: ModuleRef;
}

export type Guard = Type<CanActivate> | CanActivate;
export type Interceptor = Type<NestInterceptor> | NestInterceptor;

export interface FileRoutesModuleOptions<
  TRoutes extends readonly ResolvedRoute[] | Promise<readonly ResolvedRoute[]>,
> {
  /** Routes from `loadRoutes()`, or the promise it returns. */
  readonly routes: TRoutes;
  /** Path prefix for every file route (the generated controllers' path). */
  readonly path?: string;
  /** Guards applied to every file route, before per-route `guards` exports. */
  readonly guards?: readonly Guard[];
  /** Interceptors applied to every file route, before per-route `interceptors` exports. */
  readonly interceptors?: readonly Interceptor[];
  /** Modules whose exports guards, interceptors and handlers need. */
  readonly imports?: ModuleMetadata["imports"];
  /** Providers available to guards, interceptors and `getNest(ctx).resolve()`. */
  readonly providers?: readonly Provider[];
}

/**
 * Serves file routes inside a NestJS application. Each route file becomes a
 * real Nest controller, so routes show up in Nest's router and logs, and
 * guards, interceptors and exception filters run in Nest's usual order.
 *
 * ```ts
 * @Module({
 *   imports: [
 *     FileRoutesModule.forRoot({
 *       routes: loadRoutes(new URL("./routes", import.meta.url)),
 *       guards: [AuthGuard],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * Route modules may additionally export:
 * - `guards`: guard classes or instances for that route,
 * - `interceptors`: interceptor classes or instances for that route,
 * - `metadata`: an object whose entries are applied with `SetMetadata`, for
 *   guards that read metadata through `Reflector`.
 *
 * Responses are written by sabit (Nest's library-specific response
 * mode), so interceptors can run code before and after a handler but cannot
 * replace its response body.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules are classes with static forRoot(); the class is the module token.
export class FileRoutesModule {
  static forRoot(options: FileRoutesModuleOptions<readonly ResolvedRoute[]>): DynamicModule;
  static forRoot(
    options: FileRoutesModuleOptions<Promise<readonly ResolvedRoute[]>>,
  ): Promise<DynamicModule>;
  static forRoot(
    options: FileRoutesModuleOptions<readonly ResolvedRoute[] | Promise<readonly ResolvedRoute[]>>,
  ): DynamicModule | Promise<DynamicModule> {
    const build = (routes: readonly ResolvedRoute[]): DynamicModule => ({
      module: FileRoutesModule,
      imports: options.imports ?? [],
      providers: [...(options.providers ?? [])],
      controllers: createControllers(routes, options),
    });
    const { routes } = options;
    return routes instanceof Promise ? routes.then(build) : build(routes);
  }
}

const METHOD_DECORATORS: Record<HttpMethod, (path: string[]) => MethodDecorator> = {
  HEAD: Head,
  GET: Get,
  POST: Post,
  PUT: Put,
  PATCH: Patch,
  DELETE: Delete,
  OPTIONS: Options,
};

/** Builds one Nest controller class per route. Exported for advanced setups and tests. */
export function createControllers(
  routes: readonly ResolvedRoute[],
  options: Pick<FileRoutesModuleOptions<never>, "path" | "guards" | "interceptors"> = {},
): Type[] {
  const problems: RouteProblem[] = [];
  const controllers = routes.map((route) => createController(route, options, problems));
  if (problems.length > 0) throw new RouteDefinitionError(problems);
  return controllers;
}

function createController(
  route: ResolvedRoute,
  options: Pick<FileRoutesModuleOptions<never>, "path" | "guards" | "interceptors">,
  problems: RouteProblem[],
): Type {
  class FileRouteController {
    readonly moduleRef: ModuleRef;
    constructor(moduleRef: ModuleRef) {
      this.moduleRef = moduleRef;
    }
  }
  Object.defineProperty(FileRouteController, "name", { value: `FileRoute(${route.pattern})` });
  Inject(ModuleRef)(FileRouteController, undefined, 0);

  const paths = formatPaths(route, nestDialect);
  const prototype = FileRouteController.prototype as unknown as Record<string, unknown>;

  const define = (key: string, decorate: MethodDecorator) => {
    prototype[key] = function (this: FileRouteController, req: NestRequest, res: ServerResponse) {
      return handle(route, this.moduleRef, req, res);
    };
    Req()(prototype, key, 0);
    Res()(prototype, key, 1);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key) as PropertyDescriptor;
    decorate(prototype, key, descriptor);
  };

  // Declaration order is registration order: exported methods (HEAD before GET),
  // then a catch-all for everything else so unsupported methods get 405.
  for (const method of route.methods) define(`handle${method}`, METHOD_DECORATORS[method](paths));
  if (fallbackMethods(route).length > 0) define("handleUnsupportedMethod", All(paths));

  Controller(options.path ?? "")(FileRouteController);

  const guards = [...(options.guards ?? []), ...readList(route, "guards", problems)];
  if (guards.length > 0) UseGuards(...(guards as Guard[]))(FileRouteController);

  const interceptors = [
    ...(options.interceptors ?? []),
    ...readList(route, "interceptors", problems),
  ];
  if (interceptors.length > 0) {
    UseInterceptors(...(interceptors as Interceptor[]))(FileRouteController);
  }

  const metadata = route.module.metadata;
  if (metadata !== undefined) {
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      problems.push({ file: route.file, message: 'export "metadata" must be a plain object' });
    } else {
      for (const [key, value] of Object.entries(metadata)) {
        SetMetadata(key, value)(FileRouteController);
      }
    }
  }

  return FileRouteController;
}

function readList(route: ResolvedRoute, name: string, problems: RouteProblem[]): unknown[] {
  const value = route.module[name];
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== "function" && typeof v !== "object")
  ) {
    problems.push({
      file: route.file,
      message: `export "${name}" must be an array of classes or instances`,
    });
    return [];
  }
  return value;
}

async function handle(
  route: ResolvedRoute,
  moduleRef: ModuleRef,
  req: NestRequest,
  res: ServerResponse,
): Promise<void> {
  if (typeof (res as Partial<ServerResponse>).setHeader !== "function") {
    throw new Error(
      "@sabit/nest currently supports @nestjs/platform-express only; " +
        "use @sabit/fastify directly for Fastify.",
    );
  }
  const method = (req.method ?? "GET") as HttpMethod;
  const raw: NestPlatform = { framework: "nest", request: req, response: res, moduleRef };
  const ctx = createContext(route, {
    method,
    url: req.originalUrl ?? req.url ?? "/",
    params: req.params ?? {},
    headers: headersFromRecord(req.headers),
    body: await readBody(req),
    raw,
  });
  await writeNodeResponse(res, await executeRoute(route, method, ctx));
}

/** Nest parses JSON and URL-encoded bodies; text bodies are read here for parity with other adapters. */
async function readBody(req: NestRequest): Promise<unknown> {
  if (req.body !== undefined) return req.body;
  const type = req.headers["content-type"] ?? "";
  if (type.startsWith("text/") && hasNodeBody(req) && !req.readableEnded) {
    return readNodeText(req);
  }
  return undefined;
}

export interface NestAccess {
  readonly request: NestRequest;
  readonly response: ServerResponse;
  readonly moduleRef: ModuleRef;
  /** Resolves a provider from the application's container (non-strict lookup). */
  resolve<T>(token: Type<T> | string | symbol): T;
}

/**
 * Returns Nest's native request/response and DI access for a request handled
 * by this adapter. Throws if the request came through a different adapter.
 *
 * ```ts
 * export async function GET(ctx: RouteContext) {
 *   const users = getNest(ctx).resolve(UsersService);
 *   return users.findAll();
 * }
 * ```
 */
export function getNest(ctx: RouteContext): NestAccess {
  if (ctx.raw.framework !== "nest") {
    throw new Error(`getNest() called for a request handled by ${ctx.raw.framework}`);
  }
  const { request, response, moduleRef } = ctx.raw as NestPlatform;
  return {
    request,
    response,
    moduleRef,
    resolve: (token) => moduleRef.get(token, { strict: false }),
  };
}
