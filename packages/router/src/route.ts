import type { RouteContext } from "./context.ts";
import { HttpError } from "./errors.ts";
import type { ParamsOf, Query } from "./params.ts";
import { parseRoutePath } from "./segments.ts";
import type { InferOutput, StandardSchemaV1, StandardSchemaV1Issue } from "./standard-schema.ts";

const HANDLER_META = Symbol.for("sabit.handler");

/** Validation schemas for a handler. Any Standard Schema works (Zod, Valibot, ArkType, …). */
export interface RouteSchemas {
  readonly params?: StandardSchemaV1;
  readonly query?: StandardSchemaV1;
  readonly body?: StandardSchemaV1;
}

type OutputOf<S, K extends keyof RouteSchemas, Fallback> = S extends {
  readonly [P in K]: infer Schema extends StandardSchemaV1;
}
  ? InferOutput<Schema>
  : Fallback;

/** Context type for a handler declared with {@link createRoute}. */
export type ContextFor<
  P extends string,
  S extends RouteSchemas = Record<never, never>,
> = RouteContext<
  OutputOf<S, "params", ParamsOf<P>>,
  OutputOf<S, "query", Query>,
  OutputOf<S, "body", unknown>
>;

export interface HandlerMeta {
  readonly pattern: string;
  readonly schemas: RouteSchemas | undefined;
}

/**
 * A handler created by {@link RouteBuilder.handle}. It is a plain function an
 * adapter can call with an unvalidated context; validation happens inside.
 * `TResult` is kept for type-level tooling such as typed clients.
 */
export interface RouteHandler<TResult = unknown> {
  (ctx: RouteContext): Promise<Awaited<TResult>>;
  readonly [HANDLER_META]: HandlerMeta;
}

export interface RouteBuilder<P extends string> {
  readonly pattern: P;
  /** A handler with params typed from the route pattern. */
  handle<R>(handler: (ctx: ContextFor<P>) => R): RouteHandler<R>;
  /**
   * A handler whose inputs are validated first. Invalid requests get a `400`
   * with the validation issues; the handler receives the schema *output*
   * (so coercions and transforms apply).
   */
  handle<const S extends RouteSchemas, R>(
    schemas: S,
    handler: (ctx: ContextFor<P, S>) => R,
  ): RouteHandler<R>;
}

/**
 * Declares typed handlers for the route at `pattern`. The pattern must match the
 * file's location; this is checked when routes are loaded.
 *
 * ```ts
 * // routes/users/[id].ts
 * const route = createRoute("/users/[id]");
 *
 * export const GET = route.handle(({ params }) => ({ id: params.id }));
 * export const PUT = route.handle({ body: UpdateUser }, ({ params, body }) => update(params.id, body));
 * ```
 */
export function createRoute<const P extends string>(pattern: P): RouteBuilder<P> {
  if (!pattern.startsWith("/")) {
    throw new TypeError(`createRoute() pattern must start with "/", got "${pattern}"`);
  }
  if (pattern !== "/") parseRoutePath(pattern.slice(1), `createRoute("${pattern}")`);

  const handle = (
    schemasOrHandler: RouteSchemas | ((ctx: RouteContext) => unknown),
    maybeHandler?: (ctx: RouteContext) => unknown,
  ) => {
    const schemas = maybeHandler ? (schemasOrHandler as RouteSchemas) : undefined;
    const fn = maybeHandler ?? (schemasOrHandler as (ctx: RouteContext) => unknown);
    const handler = async (ctx: RouteContext) =>
      fn(schemas ? await validateContext(ctx, schemas) : ctx);
    Object.defineProperty(handler, HANDLER_META, { value: { pattern, schemas } });
    return handler;
  };

  return { pattern, handle } as RouteBuilder<P>;
}

/** Copies createRoute() metadata to a wrapper, so the pattern check still applies. */
export function copyHandlerMeta(from: unknown, to: object): void {
  const meta = getHandlerMeta(from);
  if (meta) Object.defineProperty(to, HANDLER_META, { value: meta });
}

export function getHandlerMeta(handler: unknown): HandlerMeta | undefined {
  if (typeof handler !== "function") return undefined;
  return (handler as unknown as Record<PropertyKey, HandlerMeta | undefined>)[HANDLER_META];
}

export interface ValidationIssue {
  readonly in: "params" | "query" | "body";
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

const PARTS = ["params", "query", "body"] as const;

async function validateContext(ctx: RouteContext, schemas: RouteSchemas): Promise<RouteContext> {
  const issues: ValidationIssue[] = [];
  const validated: Partial<Record<(typeof PARTS)[number], unknown>> = {};

  for (const part of PARTS) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = await schema["~standard"].validate(ctx[part]);
    if (result.issues) {
      for (const issue of result.issues) issues.push(toIssue(part, issue));
    } else {
      validated[part] = result.value;
    }
  }

  if (issues.length > 0) {
    throw new HttpError(400, "Validation failed", { details: { issues } });
  }
  return { ...ctx, ...validated } as RouteContext;
}

function toIssue(part: ValidationIssue["in"], issue: StandardSchemaV1Issue): ValidationIssue {
  const path = (issue.path ?? []).map((segment) => {
    const key = typeof segment === "object" ? segment.key : segment;
    return typeof key === "number" ? key : String(key);
  });
  return { in: part, path, message: issue.message };
}
