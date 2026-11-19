import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  compileRoutes,
  executeRoute,
  guard,
  HttpError,
  type Middleware,
  type ModuleSource,
  matchesPattern,
  type RouteContext,
  RouteDefinitionError,
  resolveRoutes,
  withMiddleware,
} from "../src/index.ts";
import { makeContext, readBody } from "./helpers.ts";

const source = (file: string, mod: unknown): ModuleSource => ({ file, load: () => mod });
const echo = ({ body }: RouteContext) => body ?? null;

async function call(
  sources: Parameters<typeof resolveRoutes>[0],
  file: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  init: Parameters<typeof makeContext>[1] = {},
) {
  const route = (await resolveRoutes(sources)).find((r) => r.file === file);
  if (!route) throw new Error(`no route ${file}`);
  const outcome = await executeRoute(
    route,
    method,
    makeContext(route.pattern, { method, ...init }),
  );
  return [outcome.status, JSON.parse((await readBody(outcome.body)) ?? "null")];
}

describe("folder schema.ts", () => {
  const Product = z.object({ name: z.string(), price: z.number().optional() });
  const sources = {
    routes: [
      source("products/api.ts", { GET: () => [], POST: echo }),
      source("products/[id]/api.ts", { PUT: echo, PATCH: echo }),
      source("users/api.ts", { POST: echo }),
    ],
    schemas: [source("products/schema.ts", { default: Product })],
  };

  it("applies to routes in its folder and below, and nowhere else", () => {
    const routes = compileRoutes({
      routes: ["products/api.ts", "products/[id]/api.ts", "users/api.ts"],
      schemas: ["products/schema.ts"],
    });
    expect(routes.map((r) => [r.file, r.schema])).toEqual([
      ["products/api.ts", "products/schema.ts"],
      ["products/[id]/api.ts", "products/schema.ts"],
      ["users/api.ts", undefined],
    ]);
  });

  it("checks POST and PUT in full and PATCH by the fields sent", async () => {
    const [status, body] = await call(sources, "products/api.ts", "POST", { body: { price: 1 } });
    expect(status).toBe(400);
    expect(body.error.details.issues.map((i: { path: string[] }) => i.path)).toEqual([["name"]]);
    expect(await call(sources, "products/api.ts", "POST", { body: { name: "Pen", x: 1 } })).toEqual(
      [200, { name: "Pen" }],
    );
    expect((await call(sources, "products/[id]/api.ts", "PUT", { body: { price: 2 } }))[0]).toBe(
      400,
    );
    expect(await call(sources, "products/[id]/api.ts", "PATCH", { body: { price: 2 } })).toEqual([
      200,
      { price: 2 },
    ]);
    expect(await call(sources, "users/api.ts", "POST", { body: { any: 1 } })).toEqual([
      200,
      { any: 1 },
    ]);
  });

  it("requires a schema as the default export", async () => {
    const error = await resolveRoutes({
      routes: [source("a/api.ts", { GET: () => 1 })],
      schemas: [source("a/schema.ts", { default: { name: "string" } })],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RouteDefinitionError);
    expect((error as RouteDefinitionError).problems[0]?.message).toMatch(
      /default export must be a schema/,
    );
  });

  it("validates inside per-endpoint middleware, so auth answers first", async () => {
    const deny: Middleware = () => {
      throw new HttpError(401);
    };
    const result = await call(
      {
        routes: [source("p/api.ts", { POST: withMiddleware(deny)(echo) })],
        schemas: [source("p/schema.ts", { default: Product })],
      },
      "p/api.ts",
      "POST",
      { body: {} },
    );
    expect(result[0]).toBe(401);
  });
});

describe("app middleware (src/middleware.ts) and guard()", () => {
  const appMiddleware = source("../middleware.ts", {
    default: guard({
      rules: [
        { path: "/**", methods: ["POST", "PUT", "PATCH", "DELETE"] },
        { path: "/**", methods: ["DELETE"], role: "admin" },
        { path: "/admin/**", role: "admin" },
      ],
      user: (ctx) => {
        const token = ctx.headers.get("authorization");
        if (token === "Bearer a") return { id: "1", role: "admin" };
        if (token === "Bearer u") return { id: "2", role: "user" };
        return undefined;
      },
    }),
  });
  const sources = {
    routes: [
      source("products/api.ts", {
        GET: () => ({ list: true }),
        POST: ({ state }: RouteContext) => state.user,
      }),
      source("products/[id]/api.ts", { DELETE: () => undefined }),
      source("admin/stats/api.ts", { GET: () => ({ stats: true }) }),
    ],
    schemas: [source("products/schema.ts", { default: z.object({ name: z.string() }) })],
    appMiddleware,
  };
  const as = (token?: string) => ({ headers: new Headers(token ? { authorization: token } : {}) });

  it("lets public requests through and checks protected ones", async () => {
    expect(await call(sources, "products/api.ts", "GET")).toEqual([200, { list: true }]);
    expect((await call(sources, "products/api.ts", "POST", { body: {} }))[0]).toBe(401);
    expect(
      await call(sources, "products/api.ts", "POST", { ...as("Bearer u"), body: { name: "x" } }),
    ).toEqual([200, { id: "2", role: "user" }]);
  });

  it("enforces roles", async () => {
    expect((await call(sources, "products/[id]/api.ts", "DELETE", as("Bearer u")))[0]).toBe(403);
    expect((await call(sources, "products/[id]/api.ts", "DELETE", as("Bearer a")))[0]).toBe(204);
    expect((await call(sources, "admin/stats/api.ts", "GET", as("Bearer u")))[0]).toBe(403);
    expect(await call(sources, "admin/stats/api.ts", "GET", as("Bearer a"))).toEqual([
      200,
      { stats: true },
    ]);
  });

  it("runs before validation", async () => {
    expect((await call(sources, "products/api.ts", "POST", { body: {} }))[0]).toBe(401);
  });

  it.each([
    ["/**", "/", true],
    ["/**", "/products/[id]", true],
    ["/products", "/products", true],
    ["/products", "/products/[id]", false],
    ["/products/*", "/products/[id]", true],
    ["/products/*", "/products", false],
    ["/products/**", "/products", true],
    ["/admin/**", "/users", false],
  ])("%s matches %s → %s", (pattern, route, expected) => {
    expect(matchesPattern(pattern, route)).toBe(expected);
  });
});
