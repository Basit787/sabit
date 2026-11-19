/** Route params as delivered to handlers: catch-alls are arrays of segments. */
export type Params = Record<string, string | string[]>;

/** Query string values; repeated keys (`?tag=a&tag=b`) become arrays. */
export type Query = Record<string, string | string[]>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type Empty = Record<never, never>;

type SegmentParams<S extends string> = S extends `[[...${infer Name}]]`
  ? { [K in Name]: string[] }
  : S extends `[...${infer Name}]`
    ? { [K in Name]: string[] }
    : S extends `[${infer Name}]`
      ? { [K in Name]: string }
      : Empty;

type PathParams<P extends string> = P extends `${infer Head}/${infer Rest}`
  ? SegmentParams<Head> & PathParams<Rest>
  : SegmentParams<P>;

/**
 * Params type for a canonical route pattern.
 *
 * ```ts
 * type P = ParamsOf<"/users/[id]/files/[...path]">;
 * //   ^? { id: string; path: string[] }
 * ```
 *
 * A non-literal `string` falls back to {@link Params}.
 */
export type ParamsOf<P extends string> = string extends P ? Params : Simplify<PathParams<P>>;
