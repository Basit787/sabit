import type { CatchAllKey } from "./context.ts";
import type { Segment } from "./segments.ts";

/*
 * How a framework spells segments: `param` for one dynamic segment (`:name`), `catchAll` for a one-or-more
 * wildcard (`*name` in Express 5, `*` in Fastify), `catchAllKey` where it stores that value (default the name).
 */
export interface PathDialect {
  param(name: string): string;
  catchAll(name: string): string;
  catchAllKey?: CatchAllKey;
}

/*
 * A route in the framework's path syntax. Optional catch-alls give two paths (without and with the
 * tail: "/docs/[[...slug]]" → ["/docs", "/docs/*slug"]), so frameworks only need required wildcards.
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
