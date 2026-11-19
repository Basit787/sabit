import { describe, expect, it } from "vitest";
import {
  createRoute,
  executeRoute,
  fallbackMethods,
  type ModuleSource,
  RouteDefinitionError,
  resolveRoutes,
} from "../src/index.ts";
import { makeContext, readBody } from "./helpers.ts";

const source = (file: string, mod: unknown): ModuleSource => ({ file, load: () => mod });

async function problemsOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RouteDefinitionError);
  return (error as RouteDefinitionError).problems;
}

describe("resolveRoutes", () => {
  it("discovers exported HTTP methods in registration order", async () => {
    const noop = () => null;
    const [route] = await resolveRoutes({
      routes: [
        source("items.ts", {
          POST: noop,
          GET: noop,
          HEAD: noop,
          DELETE: noop,
          PATCH: noop,
          PUT: noop,
          OPTIONS: noop,
          helper: () => "ignored",
          config: { not: "a handler" },
        }),
      ],
    });
    expect(route?.methods).toEqual(["HEAD", "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
  });

  it("computes the Allow list and 405 fallbacks", async () => {
    const [route] = await resolveRoutes({ routes: [source("a.ts", { GET: () => 1 })] });
    if (!route) throw new Error("missing route");
    expect(route.allow).toEqual(["HEAD", "GET", "OPTIONS"]);
    expect(fallbackMethods(route)).toEqual(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
  });

  it("supports async loaders (dynamic import)", async () => {
    const routes = await resolveRoutes({
      routes: [{ file: "a.ts", load: async () => ({ GET: () => "a" }) }],
    });
    expect(routes).toHaveLength(1);
  });

  it("wires inherited middleware, then route-level middleware, then the handler", async () => {
    const log: string[] = [];
    const mw = (name: string) => async (_ctx: unknown, next: () => Promise<unknown>) => {
      log.push(name);
      return next();
    };
    const [route] = await resolveRoutes({
      routes: [
        source("users/[id].ts", {
          middleware: mw("route"),
          GET: () => {
            log.push("handler");
            return "ok";
          },
        }),
      ],
      middleware: [
        source("users/middleware.ts", { default: [mw("users-1"), mw("users-2")] }),
        source("middleware.ts", { default: mw("root") }),
      ],
    });
    if (!route) throw new Error("missing route");
    await executeRoute(route, "GET", makeContext("/users/[id]"));
    expect(log).toEqual(["root", "users-1", "users-2", "route", "handler"]);
  });

  it("collects every malformed module into one error", async () => {
    const problems = await problemsOf(
      resolveRoutes({
        routes: [
          source("lowercase.ts", { get: () => 1 }),
          source("default.ts", { default: () => 1 }),
          source("empty.ts", {}),
          source("not-fn.ts", { GET: "hello" }),
          source("bad-mw.ts", { GET: () => 1, middleware: [() => 1, "x"] }),
          source("ok.ts", { GET: () => 1 }),
        ],
        middleware: [source("middleware.ts", { notDefault: () => 1 })],
      }),
    );
    const byFile = Object.fromEntries(problems.map((p) => [p.file, p]));
    expect(Object.keys(byFile).sort()).toEqual([
      "bad-mw.ts",
      "default.ts",
      "empty.ts",
      "lowercase.ts",
      "middleware.ts",
      "not-fn.ts",
    ]);
    expect(byFile["lowercase.ts"]?.hint).toMatch(/rename get to GET/);
    expect(byFile["default.ts"]?.hint).toMatch(/default exports aren't used/);
    expect(byFile["empty.ts"]?.hint).toMatch(/prefix the file name with _/);
    expect(byFile["not-fn.ts"]?.message).toMatch(/"GET" must be a function, got string/);
    expect(byFile["bad-mw.ts"]?.message).toMatch(/got string at index 1/);
    expect(byFile["middleware.ts"]?.message).toMatch(/must have a default export/);
  });

  it("reports load failures with the original error as cause", async () => {
    const boom = new SyntaxError("Unexpected token");
    const error = (await resolveRoutes({
      routes: [
        {
          file: "broken.ts",
          load: () => {
            throw boom;
          },
        },
      ],
    }).catch((e: unknown) => e)) as RouteDefinitionError;
    expect(error.problems[0]?.message).toBe("failed to load: Unexpected token");
    expect(error.cause).toBe(boom);
  });

  it("detects createRoute() patterns that don't match the file", async () => {
    const GET = createRoute("/user/[id]").handle(() => 1);
    const problems = await problemsOf(
      resolveRoutes({ routes: [source("users/[id].ts", { GET })] }),
    );
    expect(problems[0]?.message).toMatch(/createRoute\("\/user\/\[id\]"\)/);
    expect(problems[0]?.hint).toBe('change it to createRoute("/users/[id]")');
  });

  it("returns routes sorted by specificity", async () => {
    const routes = await resolveRoutes({
      routes: [source("[slug].ts", { GET: () => 1 }), source("about.ts", { GET: () => 1 })],
    });
    expect(routes.map((r) => r.pattern)).toEqual(["/about", "/[slug]"]);
  });
});

describe("executeRoute", () => {
  const load = async (mod: Record<string, unknown>) => {
    const [route] = await resolveRoutes({ routes: [source("thing.ts", mod)] });
    if (!route) throw new Error("missing route");
    return route;
  };

  it("normalizes the handler result", async () => {
    const route = await load({ GET: () => ({ ok: true }) });
    const outcome = await executeRoute(route, "GET", makeContext("/thing"));
    expect(outcome.status).toBe(200);
    expect(await readBody(outcome.body)).toBe('{"ok":true}');
  });

  it("serves HEAD with the GET handler when there is no HEAD export", async () => {
    const route = await load({ GET: () => "body" });
    const outcome = await executeRoute(route, "HEAD", makeContext("/thing", { method: "HEAD" }));
    expect(outcome.status).toBe(200);
  });

  it("answers 405 with Allow for unhandled methods", async () => {
    const route = await load({ GET: () => 1, POST: () => 1 });
    const outcome = await executeRoute(route, "DELETE", makeContext("/thing"));
    expect(outcome.status).toBe(405);
    expect(outcome.headers.get("allow")).toBe("HEAD, GET, POST, OPTIONS");
    expect(JSON.parse(String(outcome.body))).toEqual({
      error: { status: 405, message: "Method Not Allowed" },
    });
  });

  it("answers OPTIONS with 204 and Allow when not exported", async () => {
    const route = await load({ PUT: () => 1 });
    const outcome = await executeRoute(route, "OPTIONS", makeContext("/thing"));
    expect(outcome.status).toBe(204);
    expect(outcome.headers.get("allow")).toBe("PUT, OPTIONS");
  });

  it("turns HttpErrors into error responses", async () => {
    const { HttpError } = await import("../src/index.ts");
    const route = await load({
      GET: () => {
        throw new HttpError(404, "Thing not found");
      },
    });
    const outcome = await executeRoute(route, "GET", makeContext("/thing"));
    expect(outcome.status).toBe(404);
    expect(JSON.parse(String(outcome.body)).error.message).toBe("Thing not found");
  });

  it("rethrows other errors for the framework to handle", async () => {
    const boom = new Error("database down");
    const route = await load({
      GET: () => {
        throw boom;
      },
    });
    await expect(executeRoute(route, "GET", makeContext("/thing"))).rejects.toBe(boom);
  });
});
