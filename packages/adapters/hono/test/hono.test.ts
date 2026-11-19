import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { runConformanceSuite } from "@sabit/conformance";
import { type ModuleSource, type RouteContext, resolveRoutes } from "@sabit/router";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { getHono, registerRoutes } from "../src/index.ts";

runConformanceSuite("hono", async (routes) => {
  const app = registerRoutes(new Hono(), routes);
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
});

const source = (file: string, mod: unknown): ModuleSource => ({ file, load: () => mod });

describe("hono adapter", () => {
  it("mounts under a sub-app prefix with app.route()", async () => {
    const routes = await resolveRoutes({
      routes: [
        source("users/[id].ts", { GET: ({ params, path }: RouteContext) => ({ params, path }) }),
      ],
    });
    const app = new Hono().route("/api", registerRoutes(new Hono(), routes));
    const response = await app.request("/api/users/7");
    expect(await response.json()).toEqual({ params: { id: "7" }, path: "/api/users/7" });
  });

  it("exposes the native context through getHono()", async () => {
    const routes = await resolveRoutes({
      routes: [
        source("ua.ts", { GET: (ctx: RouteContext) => getHono(ctx).req.header("user-agent") }),
      ],
    });
    const app = registerRoutes(new Hono(), routes);
    const response = await app.request("/ua", { headers: { "user-agent": "vitest" } });
    expect(await response.text()).toBe("vitest");
  });

  it("lets Hono middleware run before file routes", async () => {
    const routes = await resolveRoutes({ routes: [source("ping.ts", { GET: () => "pong" })] });
    const app = new Hono();
    app.use(async (c, next) => {
      await next();
      c.header("x-native", "1");
    });
    registerRoutes(app, routes);
    const response = await app.request("/ping");
    expect(response.headers.get("x-native")).toBe("1");
  });

  it("rejects getHono() for other frameworks", async () => {
    const ctx = { raw: { framework: "express" } } as RouteContext;
    expect(() => getHono(ctx)).toThrow(/handled by express/);
  });
});
