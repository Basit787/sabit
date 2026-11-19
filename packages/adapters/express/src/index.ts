import {
  createContext,
  errorOutcome,
  executeRoute,
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

/** Express 5 (path-to-regexp v8) path syntax. Named wildcards yield arrays of segments. */
export const expressDialect: PathDialect = {
  param: (name) => `:${name}`,
  catchAll: (name) => `*${name}`,
};

export interface ExpressPlatform extends RawPlatform {
  readonly framework: "express";
  readonly req: Request;
  readonly res: Response;
}

export interface ExpressRouterOptions {
  /**
   * Parse JSON, URL-encoded and `text/*` bodies for file routes. Parsers run
   * only on file routes, never app-wide, and skip bodies another parser
   * already consumed. Pass `false` to bring your own, or an object to set
   * the size limit (default `"100kb"`).
   */
  bodyParser?: boolean | { limit?: string | number };
}

/**
 * Creates an Express router serving the given file routes.
 *
 * ```ts
 * const app = express();
 * app.use("/api", createRouter(await loadRoutes(new URL("./routes", import.meta.url))));
 * ```
 */
export function createRouter(
  routes: readonly ResolvedRoute[],
  options: ExpressRouterOptions = {},
): Router {
  const router = express.Router();
  const parsers =
    options.bodyParser === false
      ? []
      : [parseBody(typeof options.bodyParser === "object" ? options.bodyParser.limit : undefined)];

  for (const route of routes) {
    const handler = createHandler(route);
    for (const path of formatPaths(route, expressDialect)) {
      const expressRoute = router.route(path);
      for (const method of route.methods) {
        expressRoute[lower(method)](...parsers, handler);
      }
      // Anything the route doesn't export: 405 with Allow, or 204 for OPTIONS.
      expressRoute.all(handler);
    }
  }
  return router;
}

function createHandler(route: ResolvedRoute): RequestHandler {
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
      await writeNodeResponse(res, await executeRoute(route, method, ctx));
    } catch (error) {
      next(error);
    }
  };
}

/** JSON, URL-encoded and text parsers chained into one handler; parse failures become 400s. */
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

/**
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
