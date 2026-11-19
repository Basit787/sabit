import {
  createContext,
  errorOutcome,
  executeRoute,
  fallbackMethods,
  formatPaths,
  HttpError,
  type HttpMethod,
  isHttpError,
  outcomeToResponse,
  type PathDialect,
  queryFromSearchParams,
  type RawParams,
  type RawPlatform,
  type ResolvedRoute,
  type RouteContext,
} from "@sabit/router";
import type { Context, Env, Hono, Schema } from "hono";

/** Hono path syntax. Catch-alls use a regex param so their value can span segments. */
export const honoDialect: PathDialect = {
  param: (name) => `:${name}`,
  catchAll: (name) => `:${name}{.+}`,
};

export interface HonoPlatform extends RawPlatform {
  readonly framework: "hono";
  readonly context: Context;
}

/**
 * Registers file routes on a Hono app (or sub-app). Returns the same app.
 *
 * ```ts
 * import { Hono } from "hono";
 * import { loadRoutes } from "@sabit/router/fs";
 * import { registerRoutes } from "@sabit/hono";
 *
 * const app = registerRoutes(new Hono(), await loadRoutes(new URL("./routes", import.meta.url)));
 * ```
 *
 * Hono serves every HEAD request with the GET route, so this adapter registers
 * a route's handler under GET whenever it exports GET or HEAD, and picks the
 * HEAD export at request time when one exists.
 */
export function registerRoutes<E extends Env, S extends Schema, B extends string>(
  app: Hono<E, S, B>,
  routes: readonly ResolvedRoute[],
): Hono<E, S, B> {
  for (const route of routes) {
    const methods = new Set<HttpMethod>([...route.methods, ...fallbackMethods(route)]);
    if (methods.delete("HEAD")) methods.add("GET");
    const handler = createHandler(route);
    for (const path of formatPaths(route, honoDialect)) {
      app.on([...methods], path, handler);
    }
  }
  return app;
}

function createHandler(route: ResolvedRoute) {
  return async (c: Context): Promise<Response> => {
    try {
      const method = c.req.method as HttpMethod;
      const raw: HonoPlatform = { framework: "hono", context: c };
      const ctx = createContext(route, {
        method,
        url: c.req.url,
        params: c.req.param() as RawParams,
        headers: c.req.raw.headers,
        body: await readBody(c, method),
        raw,
      });
      return outcomeToResponse(await executeRoute(route, method, ctx));
    } catch (error) {
      if (isHttpError(error)) return outcomeToResponse(errorOutcome(error));
      throw error;
    }
  };
}

async function readBody(c: Context, method: HttpMethod): Promise<unknown> {
  if (method === "GET" || method === "HEAD" || c.req.raw.body === null) return undefined;
  const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  if (type === "application/json" || type.endsWith("+json")) {
    const text = await c.req.text();
    if (text === "") return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "Malformed JSON body");
    }
  }
  if (type === "application/x-www-form-urlencoded") {
    return queryFromSearchParams(new URLSearchParams(await c.req.text()));
  }
  if (type.startsWith("text/")) return c.req.text();
  // Other types (multipart, binary) are left to the handler: use getHono(ctx).req.
  return undefined;
}

/**
 * Returns Hono's native `Context` for a request handled by this adapter.
 * Throws if the request came through a different adapter.
 */
export function getHono(ctx: RouteContext): Context {
  if (ctx.raw.framework !== "hono") {
    throw new Error(`getHono() called for a request handled by ${ctx.raw.framework}`);
  }
  return (ctx.raw as HonoPlatform).context;
}
