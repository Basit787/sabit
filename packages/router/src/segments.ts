import { RouteDefinitionError, type RouteProblem } from "./errors.ts";

/** One URL path segment of a route. Route groups don't produce segments. */
export type Segment =
  | { readonly kind: "static"; readonly value: string }
  | { readonly kind: "dynamic"; readonly name: string }
  | { readonly kind: "catchAll"; readonly name: string }
  | { readonly kind: "optionalCatchAll"; readonly name: string };

export interface ParsedRoutePath {
  /** URL segments, root first. Empty for the root route. */
  readonly segments: readonly Segment[];
  /** Route group names (`(name)` directories) the file is nested in, outermost first. */
  readonly groups: readonly string[];
  /** Canonical, framework-neutral pattern, e.g. `/users/[id]`. */
  readonly pattern: string;
}

const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Characters allowed in static segments: RFC 3986 unreserved characters plus the
 * sub-delimiters that none of the supported routers treat as syntax.
 * Excluded on purpose: `: * ? ( ) { } + ! [ ]`.
 */
const STATIC_SEGMENT = /^[A-Za-z0-9\-._~$&'@,;=]+$/;
const GROUP = /^\(([^()[\]/]+)\)$/;

/**
 * File names (without extension) that serve their folder's own path:
 * `users/index.ts` and `users/api.ts` both serve `/users`.
 */
export const FOLDER_ROUTE_NAMES: ReadonlySet<string> = new Set(["index", "api"]);

export function renderSegment(segment: Segment): string {
  switch (segment.kind) {
    case "static":
      return segment.value;
    case "dynamic":
      return `[${segment.name}]`;
    case "catchAll":
      return `[...${segment.name}]`;
    case "optionalCatchAll":
      return `[[...${segment.name}]]`;
  }
}

export function renderPattern(segments: readonly Segment[]): string {
  return `/${segments.map(renderSegment).join("/")}`;
}

/**
 * Parses a route file path, relative to the routes directory, with `/`
 * separators and *without* its extension: `users/[id]`, `(auth)/login`, `index`,
 * `users/api`.
 *
 * Returns the parsed path or the list of problems found.
 */
export function tryParseRoutePath(
  pathWithoutExtension: string,
  file: string = pathWithoutExtension,
): { ok: true; value: ParsedRoutePath } | { ok: false; problems: RouteProblem[] } {
  const problems: RouteProblem[] = [];
  const parts = pathWithoutExtension.split("/");
  const segments: Segment[] = [];
  const groups: string[] = [];
  const seenParams = new Set<string>();

  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;

    if (isLast && FOLDER_ROUTE_NAMES.has(part)) return;

    const group = GROUP.exec(part);
    if (group) {
      if (isLast) {
        problems.push({
          file,
          message: `"${part}" looks like a route group, but route groups must be directories`,
          hint: `move it to "${part}/index" or rename it`,
        });
        return;
      }
      groups.push(group[1] as string);
      return;
    }

    const segment = parseSegment(part, file, problems);
    if (!segment) return;

    if (segment.kind !== "static") {
      if (seenParams.has(segment.name)) {
        problems.push({
          file,
          message: `param "${segment.name}" appears more than once in the path`,
          hint: "give each dynamic segment a unique name",
        });
      }
      seenParams.add(segment.name);
    }

    if ((segment.kind === "catchAll" || segment.kind === "optionalCatchAll") && !isLast) {
      const nextIsIndexOnly =
        index === parts.length - 2 && FOLDER_ROUTE_NAMES.has(parts[parts.length - 1] as string);
      if (!nextIsIndexOnly) {
        problems.push({
          file,
          message: `catch-all segment "${part}" must be the last segment of the path`,
          hint: `rename the file to "${parts.slice(0, index + 1).join("/")}" or nest it differently`,
        });
      }
    }

    segments.push(segment);
  });

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { segments, groups, pattern: renderPattern(segments) } };
}

/** Like {@link tryParseRoutePath}, but throws a {@link RouteDefinitionError}. */
export function parseRoutePath(pathWithoutExtension: string, file?: string): ParsedRoutePath {
  const result = tryParseRoutePath(pathWithoutExtension, file);
  if (!result.ok) throw new RouteDefinitionError(result.problems);
  return result.value;
}

function parseSegment(part: string, file: string, problems: RouteProblem[]): Segment | null {
  if (part === "") {
    problems.push({ file, message: "path contains an empty segment" });
    return null;
  }

  if (part.startsWith("[")) {
    const match =
      /^\[\[\.\.\.([^\]]*)\]\]$/.exec(part) ??
      /^\[\.\.\.([^\]]*)\]$/.exec(part) ??
      /^\[([^\].]*)\]$/.exec(part);
    if (!match) {
      if (!part.endsWith("]")) {
        problems.push({
          file,
          message: `"${part}" mixes static text and a dynamic segment`,
          hint: "dynamic segments must be the whole file or folder name, e.g. users/[id].ts",
        });
        return null;
      }
      problems.push({
        file,
        message: `"${part}" is not a valid dynamic segment`,
        hint: "use [name], [...name] or [[...name]] as the whole file or folder name",
      });
      return null;
    }
    const name = match[1] as string;
    if (!PARAM_NAME.test(name)) {
      problems.push({
        file,
        message: `"${name}" in "${part}" is not a valid param name`,
        hint: "param names must start with a letter or _ and contain only letters, digits and _",
      });
      return null;
    }
    if (part.startsWith("[[")) return { kind: "optionalCatchAll", name };
    if (part.startsWith("[...")) return { kind: "catchAll", name };
    return { kind: "dynamic", name };
  }

  if (part.includes("[") || part.includes("]")) {
    problems.push({
      file,
      message: `"${part}" mixes static text and a dynamic segment`,
      hint: "dynamic segments must be the whole file or folder name, e.g. users/[id].ts",
    });
    return null;
  }

  if (part === "." || part === ".." || !STATIC_SEGMENT.test(part)) {
    problems.push({
      file,
      message: `"${part}" contains characters that are not allowed in a static path segment`,
      hint: "use letters, digits and - . _ ~ (characters like : * ? ( ) { } + ! are router syntax)",
    });
    return null;
  }

  return { kind: "static", value: part };
}
