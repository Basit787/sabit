import { RouteDefinitionError, type RouteProblem } from "./errors.ts";
import { dirnameOf, stripExtension } from "./files.ts";
import { type Segment, tryParseRoutePath } from "./segments.ts";

// Route, middleware and schema.ts module paths, relative to the routes folder, `/`-separated, with extensions.
export interface RouteFiles {
  readonly routes: readonly string[];
  readonly middleware?: readonly string[];
  readonly schemas?: readonly string[];
}

/*
 * A route parsed and validated, before its module loads: its `file`, unique canonical `pattern`, the
 * `middleware` files that apply (routes root first) and the nearest `schema.ts`, if any.
 */
export interface CompiledRoute {
  readonly file: string;
  readonly pattern: string;
  readonly segments: readonly Segment[];
  readonly groups: readonly string[];
  readonly paramNames: readonly string[];
  readonly middleware: readonly string[];
  readonly schema?: string;
}

/*
 * Validates route file paths, attaches inherited middleware, detects conflicts
 * and sorts routes from most to least specific.
 *
 * Throws a {@link RouteDefinitionError} listing every problem found.
 */
export function compileRoutes(files: RouteFiles): CompiledRoute[] {
  const problems: RouteProblem[] = [];

  const middlewareByDir = byDirectory(files.middleware ?? [], "middleware", problems);
  const schemaByDir = byDirectory(files.schemas ?? [], "schema", problems);

  const routes: CompiledRoute[] = [];
  for (const file of files.routes) {
    const parsed = tryParseRoutePath(stripExtension(file), file);
    if (!parsed.ok) {
      problems.push(...parsed.problems);
      continue;
    }
    const { segments, groups, pattern } = parsed.value;
    routes.push({
      file,
      pattern,
      segments,
      groups,
      paramNames: segments.flatMap((s) => (s.kind === "static" ? [] : [s.name])),
      middleware: middlewareChain(file, middlewareByDir),
      ...nearest(file, schemaByDir),
    });
  }

  problems.push(...findConflicts(routes));

  if (problems.length > 0) throw new RouteDefinitionError(problems);
  return routes.sort(compareRoutes);
}

function byDirectory(
  files: readonly string[],
  kind: string,
  problems: RouteProblem[],
): Map<string, string> {
  const byDir = new Map<string, string>();
  for (const file of files) {
    const dir = dirnameOf(file);
    const existing = byDir.get(dir);
    if (existing) {
      problems.push({
        file,
        message: `directory "${dir || "."}" has more than one ${kind} file (also ${existing})`,
        hint: `keep a single ${kind} file per directory`,
      });
      continue;
    }
    byDir.set(dir, file);
  }
  return byDir;
}

function nearest(file: string, schemaByDir: ReadonlyMap<string, string>): { schema?: string } {
  const parts = dirnameOf(file).split("/").filter(Boolean);
  for (let depth = parts.length; depth >= 0; depth--) {
    const schema = schemaByDir.get(parts.slice(0, depth).join("/"));
    if (schema) return { schema };
  }
  return {};
}

function middlewareChain(file: string, middlewareByDir: ReadonlyMap<string, string>): string[] {
  const chain: string[] = [];
  const parts = dirnameOf(file).split("/").filter(Boolean);
  for (let depth = 0; depth <= parts.length; depth++) {
    const middleware = middlewareByDir.get(parts.slice(0, depth).join("/"));
    if (middleware) chain.push(middleware);
  }
  return chain;
}

/*
 * Two routes conflict when the same path would match both at the same specificity (same shape without
 * param names; static parts compared case-insensitively, like Express). `[[...x]]` also claims its parent.
 */
function findConflicts(routes: readonly CompiledRoute[]): RouteProblem[] {
  const owners = new Map<string, CompiledRoute>();
  const problems: RouteProblem[] = [];

  for (const route of routes) {
    for (const key of shapeKeys(route.segments)) {
      const owner = owners.get(key);
      if (!owner) {
        owners.set(key, route);
        continue;
      }
      if (owner === route) continue;
      const shown = key === "" ? "/" : key;
      problems.push({
        file: route.file,
        message: `conflicts with ${owner.file}: both handle ${shown}`,
        hint: conflictHint(owner, route),
      });
      break;
    }
  }
  return problems;
}

function conflictHint(a: CompiledRoute, b: CompiledRoute): string {
  if (a.pattern === b.pattern) {
    return "remove or rename one of the files (route groups don't change the URL)";
  }
  const optional = [a, b].find((r) => r.segments.at(-1)?.kind === "optionalCatchAll");
  if (optional) {
    return `${optional.file} is an optional catch-all, which also matches its parent path; make it required ([...name]) or remove the other route`;
  }
  return "routes that differ only in param names or letter case can't be told apart; merge them";
}

function shapeKeys(segments: readonly Segment[]): string[] {
  let base = "";
  for (const segment of segments) {
    switch (segment.kind) {
      case "static":
        base += `/${segment.value.toLowerCase()}`;
        break;
      case "dynamic":
        base += "/:";
        break;
      case "catchAll":
        return [`${base}/*`];
      case "optionalCatchAll":
        return [base, `${base}/*`];
    }
  }
  return [base];
}

const RANK: Record<Segment["kind"], number> = {
  static: 0,
  dynamic: 1,
  catchAll: 2,
  optionalCatchAll: 3,
};

/*
 * Orders routes by the first differing segment: static, dynamic, catch-all, optional catch-all; the path
 * that ends first wins. Different statics never match the same path, so they sort by name; ties by pattern.
 */
export function compareRoutes(
  a: Pick<CompiledRoute, "segments" | "pattern">,
  b: Pick<CompiledRoute, "segments" | "pattern">,
): number {
  const length = Math.max(a.segments.length, b.segments.length);
  for (let i = 0; i < length; i++) {
    const sa = a.segments[i];
    const sb = b.segments[i];
    if (!sa || !sb) return sa ? 1 : -1;
    const rank = RANK[sa.kind] - RANK[sb.kind];
    if (rank !== 0) return rank;
    if (sa.kind === "static" && sb.kind === "static" && sa.value !== sb.value) {
      return sa.value < sb.value ? -1 : 1;
    }
  }
  return a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0;
}
