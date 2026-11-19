import type { RouteContext } from "./context.ts";
import { copyHandlerMeta } from "./route.ts";

/** Runs the rest of the chain and resolves to the downstream handler's result. */
export type Next = () => Promise<unknown>;

/**
 * Framework-neutral middleware (onion model). It may:
 *
 * - run code before and after `await next()`,
 * - short-circuit by returning a value (or throwing an `HttpError`) without
 *   calling `next()`,
 * - replace the downstream result by returning something else,
 * - share data with later middleware and the handler through `ctx.state`.
 *
 * Returning `undefined` after calling `next()` keeps the downstream result.
 * Returning `undefined` *without* calling `next()` is an error, because it's
 * almost always a forgotten `await next()`.
 */
export type Middleware = (ctx: RouteContext, next: Next) => unknown;

/** Identity helper that gives inline middleware a typed context. */
export function defineMiddleware(middleware: Middleware): Middleware {
  return middleware;
}

/**
 * Composes middleware around a handler. The result is called once per request.
 *
 * Order: `middleware[0]` is outermost and runs first; the handler runs last.
 */
export function composeMiddleware(
  middleware: readonly Middleware[],
  handler: (ctx: RouteContext) => unknown,
): (ctx: RouteContext) => Promise<unknown> {
  return (ctx) => {
    let lastIndex = -1;

    const dispatch = async (index: number): Promise<unknown> => {
      if (index <= lastIndex) {
        throw new Error("next() was called more than once in the same middleware");
      }
      lastIndex = index;

      if (index === middleware.length) return handler(ctx);

      const current = middleware[index] as Middleware;
      let downstream: unknown;
      let calledNext = false;
      const result = await current(ctx, async () => {
        calledNext = true;
        downstream = await dispatch(index + 1);
        return downstream;
      });
      if (result !== undefined) return result;
      if (calledNext) return downstream;
      throw new Error(
        `middleware "${current.name || `#${index}`}" for ${ctx.route} neither called next() ` +
          "nor returned a response. Call `await next()` to continue, or return a value " +
          "(e.g. `reply(204)`) to end the request.",
      );
    };

    return dispatch(0);
  };
}

const WRAPPED = Symbol.for("sabit.wrapped-handler");

interface WrappedHandler {
  readonly middleware: readonly Middleware[];
  readonly handler: (ctx: RouteContext) => unknown;
}

/** What {@link withMiddleware} wrapped, so the router can validate inside it. */
export function getWrappedHandler(handler: unknown): WrappedHandler | undefined {
  if (typeof handler !== "function") return undefined;
  return (handler as unknown as Record<PropertyKey, WrappedHandler | undefined>)[WRAPPED];
}

/**
 * Runs middleware in front of one handler, for when only some methods of a
 * route need it (a folder's `middleware.ts` covers every route in the folder).
 *
 * ```ts
 * const auth = withMiddleware(requireToken);
 *
 * export const GET = () => products.list();                     // public
 * export const POST = auth(({ body }: RouteContext) => ...);    // protected
 * ```
 */
export function withMiddleware(
  ...middleware: Middleware[]
): <H extends (ctx: never) => unknown>(handler: H) => H {
  return (handler) => {
    const run = composeMiddleware(middleware, handler as unknown as (ctx: RouteContext) => unknown);
    const wrapped = (ctx: RouteContext) => run(ctx);
    copyHandlerMeta(handler, wrapped);
    Object.defineProperty(wrapped, WRAPPED, { value: { middleware, handler } });
    return wrapped as unknown as typeof handler;
  };
}
