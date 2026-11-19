import { type CompiledRoute, compareRoutes, compileRoutes } from "./compile.ts";
import type { RouteContext } from "./context.ts";
import { RouteDefinitionError, type RouteProblem } from "./errors.ts";
import { type AuthExport, type RouteAuth, requireUser } from "./guard.ts";
import { HTTP_METHODS, type HttpMethod } from "./methods.ts";
import { composeMiddleware, getWrappedHandler, type Middleware } from "./middleware.ts";
import { apiDocsEnabled, apiDocsRoutes } from "./openapi.ts";
import { getHandlerMeta } from "./route.ts";
import type { StandardSchemaV1 } from "./standard-schema.ts";
import { isStandardSchema, validateBody } from "./validation.ts";

// A loaded route module: named HTTP method exports plus optional extras.
export type RouteModule = Readonly<Record<string, unknown>>;

// A module file (relative to the routes folder, `/`-separated, with extension) and how to load it.
export interface ModuleSource {
  readonly file: string;
  load(): unknown;
}

/*
 * What resolveRoutes loads: route and middleware modules, schema.ts files (they check bodies in their folder
 * and below) and the app's src/middleware.ts, which runs first. `apiDocs` adds the built-in API docs at /docs
 * (off in production unless API_DOCS=true); the URL /docs is then reserved.
 */
export interface RouteSources {
  readonly routes: readonly ModuleSource[];
  readonly middleware?: readonly ModuleSource[];
  readonly schemas?: readonly ModuleSource[];
  readonly appMiddleware?: ModuleSource;
  readonly apiDocs?: false | { readonly title?: string };
}

export type ComposedHandler = (ctx: RouteContext) => Promise<unknown>;

/*
 * A compiled route, loaded: exported `methods` (HEAD before GET), the `allow` header value, `handlers` wrapped
 * in their middleware, the raw `module` (extra exports: Nest guards, docs) and its schema.ts `bodySchema`.
 */
export interface ResolvedRoute extends CompiledRoute {
  readonly methods: readonly HttpMethod[];
  readonly bodySchema?: StandardSchemaV1 | undefined;
  readonly allow: readonly HttpMethod[];
  readonly handlers: Readonly<Partial<Record<HttpMethod, ComposedHandler>>>;
  readonly module: RouteModule;
}

/*
 * Compiles and loads routes; every problem (bad names, conflicts, load failures, bad exports) is thrown
 * together. A route's `auth` is checked after all middleware (which sets ctx.state.user), before validation.
 */
export async function resolveRoutes(sources: RouteSources): Promise<ResolvedRoute[]> {
  const compiled = compileRoutes({
    routes: sources.routes.map((s) => s.file),
    middleware: (sources.middleware ?? []).map((s) => s.file),
    schemas: (sources.schemas ?? []).map((s) => s.file),
  });

  const problems: RouteProblem[] = [];
  const loadErrors: unknown[] = [];

  const load = async (source: ModuleSource): Promise<RouteModule | undefined> => {
    try {
      const mod = await source.load();
      if (typeof mod !== "object" || mod === null) {
        problems.push({ file: source.file, message: "did not load to a module object" });
        return undefined;
      }
      return mod as RouteModule;
    } catch (error) {
      loadErrors.push(error);
      problems.push({
        file: source.file,
        message: `failed to load: ${error instanceof Error ? error.message : String(error)}`,
      });
      return undefined;
    }
  };

  const routeSourceByFile = new Map(sources.routes.map((s) => [s.file, s]));
  const middlewareSources = sources.middleware ?? [];
  const schemaSources = sources.schemas ?? [];
  const appSource = sources.appMiddleware;

  const [routeModules, middlewareModules, schemaModules, appModule] = await Promise.all([
    Promise.all(compiled.map((route) => load(routeSourceByFile.get(route.file) as ModuleSource))),
    Promise.all(middlewareSources.map(load)),
    Promise.all(schemaSources.map(load)),
    appSource ? load(appSource) : undefined,
  ]);

  const schemaByFile = new Map<string, StandardSchemaV1>();
  schemaSources.forEach((source, index) => {
    const mod = schemaModules[index];
    if (!mod) return;
    if (isStandardSchema(mod.default)) schemaByFile.set(source.file, mod.default);
    else {
      problems.push({
        file: source.file,
        message: "the default export must be a schema",
        hint: "use defineSchema({ name: { type: String, required: true } }), exported by @sabit/schema",
      });
    }
  });
  const appMiddleware =
    appSource && appModule ? (readMiddlewareModule(appSource.file, appModule, problems) ?? []) : [];

  const middlewareByFile = new Map<string, Middleware[]>();
  middlewareSources.forEach((source, index) => {
    const mod = middlewareModules[index];
    if (!mod) return;
    const fns = readMiddlewareModule(source.file, mod, problems);
    if (fns) middlewareByFile.set(source.file, fns);
  });

  const resolved: ResolvedRoute[] = [];
  compiled.forEach((route, index) => {
    const mod = routeModules[index];
    if (!mod) return;
    const result = readRouteModule(route, mod, problems);
    if (!result) return;

    const chain = [
      ...appMiddleware,
      ...route.middleware.flatMap((file) => middlewareByFile.get(file) ?? []),
      ...result.middleware,
    ];
    const auth = readAuthExport(route.file, mod.auth, problems);
    const handlers: Partial<Record<HttpMethod, ComposedHandler>> = {};
    const bodySchema = route.schema ? schemaByFile.get(route.schema) : undefined;
    for (const [method, handler] of result.handlers) {
      const validated = bodySchema ? withBodySchema(method, bodySchema, handler) : handler;
      const required = auth?.(method);
      const checked = required === undefined ? validated : withAuth(required, validated);
      const composed = composeMiddleware(chain, checked);
      handlers[method] =
        required === undefined
          ? composed
          : (ctx) => {
              (ctx as { auth?: RouteAuth }).auth = required;
              return composed(ctx);
            };
    }
    const methods = result.handlers.map(([method]) => method);
    resolved.push({
      ...route,
      methods,
      allow: allowedMethods(methods),
      handlers,
      module: mod,
      bodySchema,
    });
  });

  const apiDocs = sources.apiDocs || undefined;
  if (apiDocs) {
    for (const route of resolved) {
      const first = route.segments[0];
      if (first?.kind !== "static" || first.value.toLowerCase() !== "docs") continue;
      problems.push({
        file: route.file,
        message: "/docs is the built-in API docs",
        hint: "rename the top-level docs folder; nested ones such as products/docs are fine",
      });
    }
  }

  if (problems.length > 0) {
    const cause =
      loadErrors.length === 1
        ? loadErrors[0]
        : loadErrors.length > 1
          ? new AggregateError(loadErrors)
          : undefined;
    throw new RouteDefinitionError(problems, { cause });
  }
  if (!apiDocs || !apiDocsEnabled()) return resolved;
  const access = appModule?.access as Readonly<Record<string, AuthExport | undefined>> | undefined;
  const docs = apiDocsRoutes(resolved, { title: apiDocs.title, access });
  return [...resolved, ...docs].sort(compareRoutes);
}

type Handler = (ctx: RouteContext) => unknown;

/*
 * Enforces a route's `auth` export with the user middleware put on
 * `ctx.state.user`: none is 401, a missing role 403. Fails closed: if no
 * middleware sets a user, protected routes answer 401.
 */
function withAuth(required: RouteAuth, handler: Handler): Handler {
  return (ctx) => {
    requireUser(ctx, required);
    return handler(ctx);
  };
}

// Reads a route file's `auth` export into "what does this method require".
function readAuthExport(
  file: string,
  value: unknown,
  problems: RouteProblem[],
): ((method: HttpMethod) => RouteAuth | undefined) | undefined {
  if (value === undefined || value === false) return undefined;
  const one = (v: unknown): RouteAuth | undefined | null => {
    if (v === undefined || v === false) return undefined;
    if (v === true || (typeof v === "string" && v !== "")) return v;
    if (Array.isArray(v) && v.length > 0 && v.every((r) => typeof r === "string" && r !== "")) {
      return v as readonly string[];
    }
    return null;
  };
  const invalid = () => {
    problems.push({
      file,
      message:
        'export "auth" must be true, a role, a list of roles, or an object of those per method',
      hint: 'e.g. export const auth = true; or export const auth = { POST: true, DELETE: "admin" };',
    });
    return undefined;
  };
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const perMethod = new Map<HttpMethod, RouteAuth>();
    for (const [key, v] of Object.entries(value)) {
      const required = one(v);
      if (!HTTP_METHODS.includes(key as HttpMethod) || required === null) return invalid();
      if (required !== undefined) perMethod.set(key as HttpMethod, required);
    }
    return (method) => perMethod.get(method);
  }
  const required = one(value);
  if (required === null || required === undefined) return invalid();
  return () => required;
}

function readRouteModule(
  route: CompiledRoute,
  mod: RouteModule,
  problems: RouteProblem[],
): { handlers: Array<[HttpMethod, Handler]>; middleware: Middleware[] } | undefined {
  const file = route.file;
  const before = problems.length;
  const handlers: Array<[HttpMethod, Handler]> = [];

  for (const method of HTTP_METHODS) {
    const value = mod[method];
    if (value === undefined) continue;
    if (typeof value !== "function") {
      problems.push({
        file,
        message: `export "${method}" must be a function, got ${typeOf(value)}`,
      });
      continue;
    }
    const meta = getHandlerMeta(value);
    if (meta && meta.pattern !== route.pattern) {
      problems.push({
        file,
        message: `${method} was created with createRoute("${meta.pattern}") but this file handles "${route.pattern}"`,
        hint: `change it to createRoute("${route.pattern}")`,
      });
      continue;
    }
    handlers.push([method, value as Handler]);
  }

  const middleware = readMiddlewareValue(file, mod.middleware, 'export "middleware"', problems);

  if (handlers.length === 0 && problems.length === before) {
    const lowercase = HTTP_METHODS.filter((m) => typeof mod[m.toLowerCase()] === "function");
    problems.push({
      file,
      message: "exports no HTTP method handlers",
      hint:
        lowercase.length > 0
          ? `method exports must be uppercase: rename ${lowercase.map((m) => m.toLowerCase()).join(", ")} to ${lowercase.join(", ")}`
          : typeof mod.default === "function"
            ? "default exports aren't used; export named handlers such as `export function GET() {}`"
            : `export at least one of ${HTTP_METHODS.join(", ")}, or prefix the file name with _ to keep it out of routing`,
    });
  }

  if (problems.length > before) return undefined;
  return { handlers, middleware: middleware ?? [] };
}

/*
 * A folder's schema.ts checks POST and PUT bodies in full and PATCH bodies field by field. It runs inside
 * per-endpoint middleware too, so auth still answers before validation.
 */
function withBodySchema(
  method: HttpMethod,
  validator: StandardSchemaV1,
  handler: Handler,
): Handler {
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return handler;
  const wrapped = getWrappedHandler(handler);
  if (wrapped) {
    return composeMiddleware(
      wrapped.middleware,
      withBodySchema(method, validator, wrapped.handler),
    );
  }
  const partial = (validator as { partial?: () => StandardSchemaV1 }).partial;
  const check =
    method === "PATCH" && typeof partial === "function" ? partial.call(validator) : validator;
  return async (ctx) => handler({ ...ctx, body: await validateBody(check, ctx.body) });
}

function readMiddlewareModule(
  file: string,
  mod: RouteModule,
  problems: RouteProblem[],
): Middleware[] | undefined {
  if (mod.default === undefined) {
    problems.push({
      file,
      message: "middleware files must have a default export",
      hint: "export default defineMiddleware(async (ctx, next) => { await next(); })",
    });
    return undefined;
  }
  return readMiddlewareValue(file, mod.default, "default export", problems);
}

function readMiddlewareValue(
  file: string,
  value: unknown,
  label: string,
  problems: RouteProblem[],
): Middleware[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const invalid = list.findIndex((item) => typeof item !== "function");
  if (invalid !== -1) {
    problems.push({
      file,
      message: `${label} must be a middleware function or an array of them, got ${typeOf(list[invalid])}${Array.isArray(value) ? ` at index ${invalid}` : ""}`,
    });
    return undefined;
  }
  return list as Middleware[];
}

function allowedMethods(methods: readonly HttpMethod[]): HttpMethod[] {
  const allow = new Set(methods);
  if (allow.has("GET")) allow.add("HEAD");
  allow.add("OPTIONS");
  return HTTP_METHODS.filter((m) => allow.has(m));
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
