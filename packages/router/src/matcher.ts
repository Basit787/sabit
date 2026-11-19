import { compareRoutes } from "./compile.ts";
import type { Params } from "./params.ts";
import type { Segment } from "./segments.ts";

export interface MatchableRoute {
  readonly pattern: string;
  readonly segments: readonly Segment[];
}

export interface RouteMatch<R> {
  readonly route: R;
  readonly params: Params;
}

/**
 * A framework-independent matcher, used for route inspection and tests. It
 * follows the same precedence adapters register routes in. Matching is
 * case-sensitive, ignores a trailing slash, and percent-decodes segments.
 */
export function createMatcher<R extends MatchableRoute>(
  routes: readonly R[],
): (pathname: string) => RouteMatch<R> | null {
  const ordered = [...routes].sort(compareRoutes);

  return (pathname) => {
    const parts = decodeParts(pathname);
    if (!parts) return null;
    for (const route of ordered) {
      const params = matchSegments(route.segments, parts);
      if (params) return { route, params };
    }
    return null;
  };
}

function decodeParts(pathname: string): string[] | null {
  try {
    return pathname
      .split("/")
      .filter((part) => part !== "")
      .map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
}

function matchSegments(segments: readonly Segment[], parts: readonly string[]): Params | null {
  const params: Params = {};
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as Segment;
    const part = parts[i];
    switch (segment.kind) {
      case "static":
        if (part !== segment.value) return null;
        break;
      case "dynamic":
        if (part === undefined) return null;
        params[segment.name] = part;
        break;
      case "catchAll":
        if (part === undefined) return null;
        params[segment.name] = parts.slice(i);
        return params;
      case "optionalCatchAll":
        params[segment.name] = parts.slice(i);
        return params;
    }
  }
  return parts.length === segments.length ? params : null;
}
