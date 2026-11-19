import type { RouteContext } from "./context.ts";
import { HttpError } from "./errors.ts";
import { HTTP_METHODS, type HttpMethod } from "./methods.ts";
import type { ResolvedRoute } from "./resolve.ts";
import { errorOutcome, outcomeFromError, type RouteOutcome, toOutcome } from "./response.ts";

/**
 * Runs a route for one request: middleware, handler and result normalization.
 *
 * - `method` is the method the adapter registered the call under.
 * - A HEAD request without an explicit HEAD handler runs the GET handler.
 * - OPTIONS without a handler answers `204` with an `Allow` header.
 * - Other methods without a handler answer `405` with an `Allow` header.
 * - `HttpError`s become error responses; any other error is rethrown so the
 *   framework's error handling sees it.
 */
export async function executeRoute(
  route: ResolvedRoute,
  method: HttpMethod,
  ctx: RouteContext,
): Promise<RouteOutcome> {
  const handler = route.handlers[method] ?? (method === "HEAD" ? route.handlers.GET : undefined);
  const allow = route.allow.join(", ");

  if (!handler) {
    if (method === "OPTIONS") {
      return { status: 204, headers: new Headers({ allow }), body: null };
    }
    return errorOutcome(new HttpError(405, "Method Not Allowed", { headers: { allow } }));
  }

  try {
    return await toOutcome(await handler(ctx));
  } catch (error) {
    return outcomeFromError(error);
  }
}

/**
 * Methods an adapter should register a fallback for, so that unsupported
 * methods get `405` (and OPTIONS gets `204`) instead of `404`. HEAD is left
 * out when GET exists, because every supported framework already answers HEAD
 * with the GET handler.
 */
export function fallbackMethods(route: ResolvedRoute): HttpMethod[] {
  return HTTP_METHODS.filter(
    (method) => !route.methods.includes(method) && !(method === "HEAD" && route.handlers.GET),
  );
}
