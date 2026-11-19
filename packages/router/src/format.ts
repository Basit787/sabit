import type { CatchAllKey } from "./context.ts";
import type { Segment } from "./segments.ts";

/** How a framework spells dynamic and catch-all segments. */
export interface PathDialect {
  /** A single dynamic segment, e.g. `(name) => ":" + name`. */
  param(name: string): string;
  /** A one-or-more segment wildcard, e.g. `*name` (Express 5) or `*` (Fastify). */
  catchAll(name: string): string;
  /** Where the framework stores a catch-all's value. Defaults to the param name. */
  catchAllKey?: CatchAllKey;
}

/**
 * Converts a route to the framework's path syntax. Optional catch-alls produce
 * two paths, one without the tail and one with it, so frameworks only need to
 * support required wildcards.
 *
 * ```ts
 * formatPaths(route, { param: (n) => `:${n}`, catchAll: (n) => `*${n}` });
 * // "/docs/[[...slug]]" -> ["/docs", "/docs/*slug"]
 * ```
 */
export function formatPaths(
  route: { readonly segments: readonly Segment[] },
  dialect: PathDialect,
): string[] {
  const parts: string[] = [];
  for (const segment of route.segments) {
    switch (segment.kind) {
      case "static":
        parts.push(segment.value);
        break;
      case "dynamic":
        parts.push(dialect.param(segment.name));
        break;
      case "catchAll":
        parts.push(dialect.catchAll(segment.name));
        break;
      case "optionalCatchAll":
        return [join(parts), join([...parts, dialect.catchAll(segment.name)])];
    }
  }
  return [join(parts)];
}

function join(parts: readonly string[]): string {
  return `/${parts.join("/")}`;
}
