import { createRunner, type RouteRunner, type SecurityOptions } from "@sabit/adapter-common";
import {
  createContext,
  errorOutcome,
  formatPaths,
  HttpError,
  type HttpMethod,
  headersFromRecord,
  type PathDialect,
  type RawParams,
  type RawPlatform,
  type ResolvedRoute,
  type RouteContext,
} from "@sabit/router";
import { writeNodeResponse } from "@sabit/router/node";
import express, { type Request, type RequestHandler, type Response, type Router } from "express";

// Express 5 (path-to-regexp v8) path syntax. Named wildcards yield arrays of segments.
export const expressDialect: PathDialect = {
  param: (name) => `:${name}`,
  catchAll: (name) => `*${name}`,
};

export interface ExpressPlatform extends RawPlatform {
  readonly framework: "express";
  readonly req: Request;
  readonly res: Response;
}

/*
 * `bodyParser`: JSON, URL-encoded and `text/*` parsing on file routes only (default limit "100kb");
 * `false` brings your own, `{ limit }` changes the limit. Plus the shared SecurityOptions.
 */
export interface ExpressRouterOptions extends SecurityOptions {
  bodyParser?: boolean | { limit?: string | number };
}

/*
 * An Express router for the file routes: `app.use("/api", createRouter(routes))`. Every request goes
 * through the shared runner (rate limit, plain 500s); unexported methods get 405, OPTIONS 204.
 */
export function createRouter(
  routes: readonly ResolvedRoute[],
  options: ExpressRouterOptions = {},
): Router {
  const router = express.Router();
  const run = createRunner(options);
  const parsers =
    options.bodyParser === false
      ? []
      : [parseBody(typeof options.bodyParser === "object" ? options.bodyParser.limit : undefined)];

  for (const route of routes) {
    const handler = createHandler(route, run);
    for (const path of formatPaths(route, expressDialect)) {
      const expressRoute = router.route(path);
      for (const method of route.methods) {
        expressRoute[lower(method)](...parsers, handler);
      }
      expressRoute.all(handler);
    }
  }
  return router;
}

function createHandler(route: ResolvedRoute, run: RouteRunner): RequestHandler {
  return async (req, res, next) => {
    try {
      const method = req.method as HttpMethod;
      const raw: ExpressPlatform = { framework: "express", req, res };
      const ctx = createContext(route, {
        method,
        url: req.originalUrl,
        params: req.params as RawParams,
        headers: headersFromRecord(req.headers),
        body: req.body,
        raw,
      });
      await writeNodeResponse(res, await run(route, method, ctx, req.ip));
    } catch (error) {
      next(error);
    }
  };
}

// JSON, URL-encoded and text parsers chained into one handler; parse failures become 400s.
function parseBody(limit: string | number = "100kb"): RequestHandler {
  const parsers: RequestHandler[] = [
    express.json({ limit }),
    express.urlencoded({ extended: false, limit }),
    express.text({ type: "text/*", limit }),
  ];
  return (req, res, next) => {
    let index = 0;
    const run = (error?: unknown): void => {
      if (error) {
        const status = (error as { status?: unknown }).status;
        if (typeof status === "number" && status >= 400 && status < 500) {
          const message = status === 400 ? "Malformed request body" : (error as Error).message;
          writeNodeResponse(res, errorOutcome(new HttpError(status, message))).catch(next);
          return;
        }
        next(error);
        return;
      }
      const parser = parsers[index++];
      if (parser) parser(req, res, run);
      else next();
    };
    run();
  };
}

function lower(method: HttpMethod) {
  return method.toLowerCase() as Lowercase<HttpMethod>;
}

/*
 * Returns Express's native request and response for a request handled by this
 * adapter. Throws if the request came through a different adapter.
 */
export function getExpress(ctx: RouteContext): { req: Request; res: Response } {
  if (ctx.raw.framework !== "express") {
    throw new Error(`getExpress() called for a request handled by ${ctx.raw.framework}`);
  }
  const { req, res } = ctx.raw as ExpressPlatform;
  return { req, res };
}

export { corsOrigin } from "@sabit/adapter-common";
