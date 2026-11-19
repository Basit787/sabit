import type { RouteContext } from "./context.ts";
import { HttpError } from "./errors.ts";
import { HTTP_METHODS, type HttpMethod } from "./methods.ts";
import type { ResolvedRoute } from "./resolve.ts";
import { errorOutcome, outcomeFromError, type RouteOutcome, toOutcome } from "./response.ts";

/*
 * Runs a route: middleware, handler, result. HEAD falls back to GET; a missing method answers 405
 * (OPTIONS 204), with Allow. HttpErrors become responses; other errors are rethrown to the adapter.
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

/*
 * Methods an adapter should register a fallback for, so unsupported ones get 405 (OPTIONS 204) instead
 * of 404. HEAD is left out when GET exists: every framework answers HEAD with GET.
 */
export function fallbackMethods(route: ResolvedRoute): HttpMethod[] {
  return HTTP_METHODS.filter(
    (method) => !route.methods.includes(method) && !(method === "HEAD" && route.handlers.GET),
  );
}
