import type { RouteAuth } from "./guard.ts";
import type { HttpMethod } from "./methods.ts";
import type { Params, ParamsOf, Query } from "./params.ts";
import type { Segment } from "./segments.ts";

/*
 * Augment to type your app, e.g. `declare module "@sabit/router" { interface Register {
 * state: { user?: { id: string } } } }`.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by applications via declaration merging
export interface Register {}

// Per-request data shared between middleware and handlers.
export type State = Register extends { state: infer S extends object }
  ? S
  : Record<string, unknown>;

/*
 * Framework escape hatch. Each adapter puts its native objects here and exports
 * a typed accessor (for example `getExpress(ctx)` from `@sabit/express`).
 */
export interface RawPlatform {
  readonly framework: string;
}

// Path pattern (e.g. `"/users/[id]"`) or an explicit params object type.
type ParamsArg<T> = T extends string ? ParamsOf<T> : T;

/*
 * What every handler and middleware receives, identical across frameworks. `RouteContext<"/users/[id]">`
 * types `params`; a route's context is assignable to a plain RouteContext (why this is an alias).
 */
export type RouteContext<TParams = string, TQuery = Query, TBody = unknown> = RequestContext<
  ParamsArg<TParams>,
  TQuery,
  TBody
>;

/*
 * The shape behind RouteContext (prefer that): `method` ("HEAD" even when GET serves it), `path`, matched
 * `route` pattern, params, query, parsed `body` (JSON, form object or text), headers, state, raw, and `auth`.
 */
export interface RequestContext<TParams = Params, TQuery = Query, TBody = unknown> {
  readonly method: HttpMethod;
  readonly path: string;
  readonly route: string;
  readonly params: TParams;
  readonly query: TQuery;
  readonly body: TBody;
  readonly headers: Headers;
  readonly state: State;
  readonly raw: RawPlatform;
  readonly auth?: RouteAuth;
}

// Raw param values as a framework reports them.
export type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/*
 * What an adapter passes to createContext: the request `url` (path with query, or absolute), `params` as
 * the framework reports them (already decoded), headers, body and the raw platform objects.
 */
export interface ContextInit {
  readonly method: HttpMethod;
  readonly url: string;
  readonly params: RawParams;
  readonly headers: Headers;
  readonly body: unknown;
  readonly raw: RawPlatform;
}

// The parts of a route that context creation needs.
export interface ContextRoute {
  readonly pattern: string;
  readonly segments: readonly Segment[];
}

// Maps a catch-all param name to the key the framework stores its value under.
export type CatchAllKey = (name: string) => string;

// Builds a {@link RouteContext}. Used by adapters; applications don't need it.
export function createContext(
  route: ContextRoute,
  init: ContextInit,
  catchAllKey?: CatchAllKey,
): RouteContext {
  const url = new URL(init.url, "http://localhost");
  return {
    method: init.method,
    path: url.pathname,
    route: route.pattern,
    params: normalizeParams(route.segments, init.params, catchAllKey),
    query: queryFromSearchParams(url.searchParams),
    body: init.body,
    headers: init.headers,
    state: {} as State,
    raw: init.raw,
  };
}

/*
 * Converts framework params to sabit params: dynamic segments become
 * strings, catch-alls become arrays of segments (empty for an optional
 * catch-all that matched nothing).
 */
export function normalizeParams(
  segments: readonly Segment[],
  raw: RawParams,
  catchAllKey: CatchAllKey = (name) => name,
): Params {
  const params: Params = {};
  for (const segment of segments) {
    switch (segment.kind) {
      case "static":
        break;
      case "dynamic": {
        const value = raw[segment.name];
        params[segment.name] = Array.isArray(value) ? value.join("/") : ((value as string) ?? "");
        break;
      }
      case "catchAll":
      case "optionalCatchAll":
        params[segment.name] = splitCatchAll(raw[catchAllKey(segment.name)]);
        break;
    }
  }
  return params;
}

function splitCatchAll(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((part) => part !== "");
  return (value as string).split("/").filter((part) => part !== "");
}

export function queryFromSearchParams(searchParams: URLSearchParams): Query {
  const query: Query = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    query[key] = values.length === 1 ? (values[0] as string) : values;
  }
  return query;
}

// Converts Node-style headers (`IncomingHttpHeaders`) to web `Headers`.
export function headersFromRecord(
  record: Readonly<Record<string, string | readonly string[] | number | undefined>>,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, String(value));
    }
  }
  return headers;
}
