import {
  createRunner,
  DEFAULT_BODY_LIMIT,
  type RouteRunner,
  readTextWithLimit,
  type SecurityOptions,
} from "@sabit/adapter-common";
import {
  createContext,
  errorOutcome,
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

// Hono path syntax. Catch-alls use a regex param so their value can span segments.
export const honoDialect: PathDialect = {
  param: (name) => `:${name}`,
  catchAll: (name) => `:${name}{.+}`,
};

export interface HonoPlatform extends RawPlatform {
  readonly framework: "hono";
  readonly context: Context;
}

/*
 * `bodyLimit`: largest JSON, form or text body read, in bytes (default 100 KB; over it, 413), plus the
 * shared SecurityOptions.
 */
export interface HonoRoutesOptions extends SecurityOptions {
  readonly bodyLimit?: number;
}

// The client's IP on @hono/node-server; other runtimes share one rate-limit bucket.
function clientAddress(c: Context): string | undefined {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress;
}

/*
 * Registers the file routes on a Hono app (or sub-app) and returns the same app.
 * Hono answers HEAD with the GET route, so GET/HEAD exports share it; HEAD is picked per request.
 */
export function registerRoutes<E extends Env, S extends Schema, B extends string>(
  app: Hono<E, S, B>,
  routes: readonly ResolvedRoute[],
  options: HonoRoutesOptions = {},
): Hono<E, S, B> {
  const run = createRunner(options);
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  for (const route of routes) {
    const methods = new Set<HttpMethod>([...route.methods, ...fallbackMethods(route)]);
    if (methods.delete("HEAD")) methods.add("GET");
    const handler = createHandler(route, run, bodyLimit);
    for (const path of formatPaths(route, honoDialect)) {
      app.on([...methods], path, handler);
    }
  }
  return app;
}

function createHandler(route: ResolvedRoute, run: RouteRunner, bodyLimit: number) {
  return async (c: Context): Promise<Response> => {
    try {
      const method = c.req.method as HttpMethod;
      const raw: HonoPlatform = { framework: "hono", context: c };
      const ctx = createContext(route, {
        method,
        url: c.req.url,
        params: c.req.param() as RawParams,
        headers: c.req.raw.headers,
        body: await readBody(c, method, bodyLimit),
        raw,
      });
      return outcomeToResponse(await run(route, method, ctx, clientAddress(c)));
    } catch (error) {
      if (isHttpError(error)) return outcomeToResponse(errorOutcome(error));
      throw error;
    }
  };
}

/*
 * Reads JSON, form and text bodies, at most `limit` bytes (413 before a larger one fills memory).
 * Other types (multipart, binary) are left to the handler: use getHono(ctx).req.
 */
async function readBody(c: Context, method: HttpMethod, limit: number): Promise<unknown> {
  const stream = c.req.raw.body;
  if (method === "GET" || method === "HEAD" || stream === null) return undefined;
  const readText = () => readTextWithLimit(stream, c.req.header("content-length"), limit);
  const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  if (type === "application/json" || type.endsWith("+json")) {
    const text = await readText();
    if (text === "") return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "Malformed JSON body");
    }
  }
  if (type === "application/x-www-form-urlencoded") {
    return queryFromSearchParams(new URLSearchParams(await readText()));
  }
  if (type.startsWith("text/")) return readText();
  return undefined;
}

/*
 * Returns Hono's native `Context` for a request handled by this adapter.
 * Throws if the request came through a different adapter.
 */
export function getHono(ctx: RouteContext): Context {
  if (ctx.raw.framework !== "hono") {
    throw new Error(`getHono() called for a request handled by ${ctx.raw.framework}`);
  }
  return (ctx.raw as HonoPlatform).context;
}

export { corsOrigin } from "@sabit/adapter-common";
