import { runConformanceSuite } from "@sabit/conformance";
import { type ModuleSource, type RouteContext, resolveRoutes } from "@sabit/router";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { fileRoutes, getFastify } from "../src/index.ts";

runConformanceSuite("fastify", async (routes) => {
  const app = Fastify();
  await app.register(fileRoutes, { routes });
  const baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  return { baseUrl, close: () => app.close() };
});

runConformanceSuite("fastify (prefix /api)", async (routes) => {
  const app = Fastify();
  await app.register(fileRoutes, { routes, prefix: "/api" });
  const baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  return { baseUrl: `${baseUrl}/api`, close: () => app.close() };
});

const source = (file: string, mod: unknown): ModuleSource => ({ file, load: () => mod });

describe("fastify adapter", () => {
  it("exposes native request/reply through getFastify()", async () => {
    const routes = await resolveRoutes({
      routes: [
        source("id.ts", { GET: (ctx: RouteContext) => ({ id: getFastify(ctx).request.id }) }),
      ],
    });
    const app = Fastify({ genReqId: () => "req-1" });
    await app.register(fileRoutes, { routes });
    const response = await app.inject({ url: "/id" });
    expect(response.json()).toEqual({ id: "req-1" });
  });

  it("registers real per-method routes visible to Fastify tooling", async () => {
    const routes = await resolveRoutes({
      routes: [source("users/[id].ts", { GET: () => 1, PUT: () => 1 })],
    });
    const app = Fastify();
    await app.register(fileRoutes, { routes });
    await app.ready();
    expect(app.hasRoute({ method: "GET", url: "/users/:id" })).toBe(true);
    expect(app.hasRoute({ method: "PUT", url: "/users/:id" })).toBe(true);
  });

  it("keeps a form parser the app already registered", async () => {
    const routes = await resolveRoutes({
      routes: [source("form.ts", { POST: ({ body }: RouteContext) => body })],
    });
    const app = Fastify();
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, _body, done) => done(null, { custom: true }),
    );
    await app.register(fileRoutes, { routes });
    const response = await app.inject({
      method: "POST",
      url: "/form",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "a=1",
    });
    expect(response.json()).toEqual({ custom: true });
  });

  it("sends unexpected errors to Fastify's error handler", async () => {
    const routes = await resolveRoutes({
      routes: [
        source("crash.ts", {
          GET: () => {
            throw new Error("db down");
          },
        }),
      ],
    });
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      reply.code(503).send({ handled: (error as Error).message });
    });
    await app.register(fileRoutes, { routes });
    const response = await app.inject({ url: "/crash" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ handled: "db down" });
  });
});
