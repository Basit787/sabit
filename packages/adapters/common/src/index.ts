/*
 * What every sabit adapter does the same way around a route: rate limiting,
 * turning unexpected errors into a plain 500 (never their message or stack),
 * body size limits, and the CORS origins the starters allow.
 */
import {
  errorOutcome,
  executeRoute,
  HttpError,
  type HttpMethod,
  isHttpError,
  type ResolvedRoute,
  type RouteContext,
  type RouteOutcome,
} from "@sabit/router";

// Largest request body adapters read by default: 100 KB, like Express and NestJS.
export const DEFAULT_BODY_LIMIT = 100 * 1024;

// Rate limit: `max` requests per client (default 100) per `windowMs` (default 60 000 ms).
export interface RateLimitOptions {
  readonly max?: number;
  readonly windowMs?: number;
}

/*
 * What every adapter takes: `rateLimit` (429 + Retry-After, 100/min per IP per process; false turns it
 * off, e.g. behind a gateway) and `onError` (gets non-HttpErrors before the plain 500; default console.error).
 */
export interface SecurityOptions {
  readonly rateLimit?: RateLimitOptions | false;
  readonly onError?: (error: unknown, ctx: RouteContext) => void;
}

/*
 * Counts requests per key in fixed windows and returns a 429 once a key is over; finished windows
 * are swept now and then, so memory stays bounded.
 */
export function createRateLimiter(
  options: RateLimitOptions = {},
): (key: string) => HttpError | undefined {
  const max = options.max ?? 100;
  const windowMs = options.windowMs ?? 60_000;
  const hits = new Map<string, { count: number; resetAt: number }>();
  let sweepAt = Date.now() + windowMs;
  return (key) => {
    const now = Date.now();
    if (now >= sweepAt) {
      for (const [k, entry] of hits) if (entry.resetAt <= now) hits.delete(k);
      sweepAt = now + windowMs;
    }
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count <= max) return undefined;
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return new HttpError(429, "Too Many Requests", {
      headers: { "retry-after": String(retryAfter) },
    });
  };
}

// Runs one route for an adapter; see {@link createRunner}.
export type RouteRunner = (
  route: ResolvedRoute,
  method: HttpMethod,
  ctx: RouteContext,
  client: string | undefined,
) => Promise<RouteOutcome>;

/*
 * The request runner an adapter calls instead of `executeRoute`: checks the
 * client's rate limit, runs the route, and answers unexpected errors with a
 * plain JSON 500 after passing them to `onError`.
 */
export function createRunner(options: SecurityOptions = {}): RouteRunner {
  const limit = options.rateLimit === false ? undefined : createRateLimiter(options.rateLimit);
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  return async (route, method, ctx, client) => {
    const limited = limit?.(client ?? "unknown");
    if (limited) return errorOutcome(limited);
    try {
      return await executeRoute(route, method, ctx);
    } catch (error) {
      if (isHttpError(error)) return errorOutcome(error);
      onError(error, ctx);
      return errorOutcome(new HttpError(500, "Internal Server Error"));
    }
  };
}

/*
 * Reads a body stream as text, answering 413 as soon as it passes `limit`
 * bytes, so an oversized upload is never held in memory.
 */
export async function readTextWithLimit(
  stream: ReadableStream<Uint8Array>,
  contentLength: string | null | undefined,
  limit = DEFAULT_BODY_LIMIT,
): Promise<string> {
  if (contentLength && Number(contentLength) > limit) throw tooLarge(limit);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function tooLarge(limit: number): HttpError {
  return new HttpError(413, `Request body is larger than ${limit} bytes`);
}

/*
 * The origins CORS should allow: `CORS_ORIGIN` (comma-separated), or any
 * origin outside production. Throws in production without `CORS_ORIGIN`, so an
 * API is never opened to every website by accident.
 */
export function corsOrigin(
  env: Record<string, string | undefined> = process.env,
): string | string[] {
  const origins = (env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length > 0) return origins;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Set CORS_ORIGIN to the origins allowed to call this API (comma-separated). " +
        "Allowing every origin is only for development.",
    );
  }
  return "*";
}
