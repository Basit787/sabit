import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runConformanceSuite } from "@sabit/conformance";
import {
  HttpError,
  type ModuleSource,
  type ResolvedRoute,
  type RouteContext,
  resolveRoutes,
} from "@sabit/router";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createRouter, getExpress } from "../src/index.ts";

async function listen(
  app: express.Express,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

runConformanceSuite("express", async (routes) => {
  const app = express();
  app.use(createRouter(routes));
  return listen(app);
});

runConformanceSuite("express (mounted under /api)", async (routes) => {
  const app = express();
  app.use("/api", createRouter(routes));
  const server = await listen(app);
  return { ...server, baseUrl: `${server.baseUrl}/api` };
});

const source = (file: string, mod: unknown): ModuleSource => ({ file, load: () => mod });

describe("express adapter", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(() => close?.());

  const start = async (routes: ResolvedRoute[], setup?: (app: express.Express) => void) => {
    const app = express();
    setup?.(app);
    app.use(createRouter(routes));
    const server = await listen(app);
    close = server.close;
    return server.baseUrl;
  };

  it("exposes native req/res through getExpress()", async () => {
    const routes = await resolveRoutes({
      routes: [source("ip.ts", { GET: (ctx: RouteContext) => ({ ip: getExpress(ctx).req.ip }) })],
    });
    const url = await start(routes);
    expect(await (await fetch(`${url}/ip`)).json()).toEqual({ ip: "127.0.0.1" });
  });

  it("answers unexpected errors with a plain 500 and reports them to onError", async () => {
    const seen: unknown[] = [];
    const routes = await resolveRoutes({
      routes: [
        source("crash.ts", {
          GET: () => {
            throw new Error("db down");
          },
        }),
        source("missing.ts", {
          GET: () => {
            throw new HttpError(404);
          },
        }),
      ],
    });
    const app = express();
    app.use(createRouter(routes, { onError: (error) => seen.push(error) }));
    const server = await listen(app);
    close = server.close;

    const crash = await fetch(`${server.baseUrl}/crash`);
    expect(crash.status).toBe(500);
    expect(await crash.json()).toEqual({
      error: { status: 500, message: "Internal Server Error" },
    });
    expect((await fetch(`${server.baseUrl}/missing`)).status).toBe(404);
    expect(seen.map((e) => (e as Error).message)).toEqual(["db down"]);
  });

  it("reuses a body already parsed by app-level middleware", async () => {
    const routes = await resolveRoutes({
      routes: [source("echo.ts", { POST: ({ body }: RouteContext) => body })],
    });
    const url = await start(routes, (app) => app.use(express.json({ reviver: (_k, v) => v })));
    const response = await fetch(`${url}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    expect(await response.json()).toEqual({ a: 1 });
  });

  it("can skip body parsing", async () => {
    const routes = await resolveRoutes({
      routes: [source("echo.ts", { POST: ({ body }: RouteContext) => ({ body: body ?? null }) })],
    });
    const app = express();
    app.use(createRouter(routes, { bodyParser: false }));
    const server = await listen(app);
    close = server.close;
    const response = await fetch(`${server.baseUrl}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    expect(await response.json()).toEqual({ body: null });
  });

  it("answers 413 for bodies over the limit", async () => {
    const routes = await resolveRoutes({ routes: [source("echo.ts", { POST: () => "ok" })] });
    const app = express();
    app.use(createRouter(routes, { bodyParser: { limit: 10 } }));
    const server = await listen(app);
    close = server.close;
    const response = await fetch(`${server.baseUrl}/echo`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "this is longer than ten bytes",
    });
    expect(response.status).toBe(413);
  });
});
