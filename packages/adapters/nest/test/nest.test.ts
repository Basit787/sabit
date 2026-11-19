import type { AddressInfo } from "node:net";
import {
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Inject,
  Module,
  type NestInterceptor,
  type Type,
} from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { runConformanceSuite } from "@sabit/conformance";
import { type ModuleSource, type RouteContext, resolveRoutes } from "@sabit/router";
import { afterEach, describe, expect, it } from "vitest";
import { createControllers, FileRoutesModule, getNest } from "../src/index.ts";

// Test modules are built with Nest's decorators called as functions, which is
// exactly what decorator syntax compiles to.
function moduleOf(metadata: Parameters<typeof Module>[0]): Type {
  class AppModule {}
  Module(metadata)(AppModule);
  return AppModule;
}

async function listen(app: INestApplication) {
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => app.close() };
}

runConformanceSuite("nest (platform-express)", async (routes) => {
  const app = await NestFactory.create(
    moduleOf({ imports: [FileRoutesModule.forRoot({ routes })] }),
    {
      logger: false,
    },
  );
  return listen(app);
});

runConformanceSuite("nest (path /api, async routes)", async (routes) => {
  const app = await NestFactory.create(
    moduleOf({
      imports: [FileRoutesModule.forRoot({ routes: Promise.resolve(routes), path: "api" })],
    }),
    { logger: false },
  );
  const server = await listen(app);
  return { ...server, baseUrl: `${server.baseUrl}/api` };
});

const source = (file: string, mod: unknown): ModuleSource => ({ file, load: () => mod });

class GreetingService {
  greet(name: string) {
    return `hello ${name}`;
  }
}

class RolesGuard implements CanActivate {
  readonly reflector: Reflector;
  constructor(reflector: Reflector) {
    this.reflector = reflector;
  }
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.get<string[] | undefined>("roles", context.getClass());
    if (!roles) return true;
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    return roles.includes(request.headers["x-role"] ?? "");
  }
}
Inject(Reflector)(RolesGuard, undefined, 0);

class HeaderInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context
      .switchToHttp()
      .getResponse<{ setHeader(k: string, v: string): void }>()
      .setHeader("x-intercepted", "yes");
    return next.handle();
  }
}

describe("nest adapter", () => {
  let app: INestApplication | undefined;
  afterEach(() => app?.close());

  const start = async (metadata: Parameters<typeof Module>[0]) => {
    app = await NestFactory.create(moduleOf(metadata), { logger: false });
    const { baseUrl } = await listen(app);
    return baseUrl;
  };

  it("resolves providers through getNest(ctx).resolve()", async () => {
    const routes = await resolveRoutes({
      routes: [
        source("greet/[name].ts", {
          GET: (ctx: RouteContext<"/greet/[name]">) =>
            getNest(ctx).resolve(GreetingService).greet(ctx.params.name),
        }),
      ],
    });
    const url = await start({
      imports: [FileRoutesModule.forRoot({ routes, providers: [GreetingService] })],
    });
    expect(await (await fetch(`${url}/greet/ada`)).text()).toBe("hello ada");
  });

  it("runs guards with per-route metadata read through Reflector", async () => {
    const routes = await resolveRoutes({
      routes: [
        source("admin.ts", { metadata: { roles: ["admin"] }, GET: () => ({ secret: true }) }),
        source("public.ts", { GET: () => ({ open: true }) }),
      ],
    });
    const url = await start({
      imports: [FileRoutesModule.forRoot({ routes, guards: [RolesGuard] })],
    });

    // Guard rejections go through Nest's exception layer (Nest's own error format).
    const denied = await fetch(`${url}/admin`);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ statusCode: 403 });

    expect((await fetch(`${url}/admin`, { headers: { "x-role": "admin" } })).status).toBe(200);
    expect((await fetch(`${url}/public`)).status).toBe(200);
  });

  it("applies guards and interceptors exported by a route file", async () => {
    const deny: CanActivate = { canActivate: () => false };
    const routes = await resolveRoutes({
      routes: [
        source("locked.ts", { guards: [deny], GET: () => 1 }),
        source("traced.ts", { interceptors: [HeaderInterceptor], GET: () => ({ ok: true }) }),
      ],
    });
    const url = await start({ imports: [FileRoutesModule.forRoot({ routes })] });
    expect((await fetch(`${url}/locked`)).status).toBe(403);
    const traced = await fetch(`${url}/traced`);
    expect(traced.headers.get("x-intercepted")).toBe("yes");
    expect(await traced.json()).toEqual({ ok: true });
  });

  it("names generated controllers after their route pattern", async () => {
    const routes = await resolveRoutes({ routes: [source("users/[id].ts", { GET: () => 1 })] });
    expect(createControllers(routes).map((c) => c.name)).toEqual(["FileRoute(/users/[id])"]);
  });

  it("rejects malformed guards exports at startup", async () => {
    const routes = await resolveRoutes({
      routes: [source("bad.ts", { guards: "AuthGuard", GET: () => 1 })],
    });
    expect(() => createControllers(routes)).toThrow(/"guards" must be an array/);
  });
});
