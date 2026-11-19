import { existsSync, readFileSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  compileRoutes,
  type HttpMethod,
  parseRoutePath,
  RouteDefinitionError,
  type RouteProblem,
} from "@sabit/router";
import { scanRoutes } from "@sabit/router/fs";
import {
  catchAllRoute,
  collectionRoute,
  displayPath,
  folderSchemaFile,
  itemRoute,
  resourceNames,
  standaloneItemRoute,
} from "./templates.ts";

/** The file name generated for each endpoint folder. */
export const ROUTE_FILE = "api.ts";

export interface ScaffoldFile {
  /** Path relative to the routes directory, `/`-separated. */
  readonly file: string;
  /** `route` files serve URLs; `helper` files (controller, service) don't. */
  readonly kind: "route" | "helper";
  /** URL pattern, for route files. */
  readonly pattern: string;
  /** HTTP methods, for route files. */
  readonly methods: readonly HttpMethod[];
  readonly content: string;
}

export interface PlanOptions {
  /** Name of the item param for collections. Default `id`. */
  readonly param?: string;
  /** Also generate the `[param]/api.ts` item route for collections. Default `true`. */
  readonly item?: boolean;
  /**
   * Extension used in relative imports between generated files. `.ts` for
   * projects that run TypeScript directly, `.js` for projects compiled with
   * plain `tsc` (NestJS). See {@link detectImportExtension}.
   */
  readonly importExtension?: ".ts" | ".js";
  /** Quote style of generated code; follows the project's formatter. Default `double`. */
  readonly quote?: "double" | "single";
}

/**
 * Decides which files a folder gets:
 *
 * - `users` → `users/api.ts` (GET, POST) + `users/[id]/api.ts` (GET, PUT, PATCH, DELETE)
 * - `users/[id]` → `users/[id]/api.ts` (GET, PUT, PATCH, DELETE)
 * - `files/[...path]` → `files/[...path]/api.ts` (GET)
 *
 * Throws for folders that can't be endpoints by themselves (route groups,
 * private `_` folders) and for invalid names.
 */
export function planScaffold(folder: string, options: PlanOptions = {}): ScaffoldFile[] {
  const files = planFiles(folder, options);
  if (options.quote !== "single") return files;
  // Generated code has no string containing a single quote, so this is safe.
  return files.map((file) => ({ ...file, content: file.content.replaceAll('"', "'") }));
}

function planFiles(folder: string, options: PlanOptions): ScaffoldFile[] {
  const normalized = normalizeFolder(folder);
  const last = normalized.split("/").at(-1) as string;
  if (last.startsWith("_")) {
    throw new UsageError(`"${normalized}" is private (starts with _), so it can't be an endpoint`);
  }
  if (/^\(.*\)$/.test(last)) {
    throw new UsageError(
      `"${normalized}" is a route group: it organizes routes without adding to the URL. ` +
        `Add a resource inside it instead, e.g. "${normalized}/users"`,
    );
  }

  const param = options.param ?? "id";
  const ext = options.importExtension ?? ".ts";
  const { pattern, segments } = parseRoutePath(`${normalized}/api`, `${normalized}/${ROUTE_FILE}`);
  const kind = segments.at(-1)?.kind;
  const file = `${normalized}/${ROUTE_FILE}`;

  if (kind === "dynamic") {
    const name = (segments.at(-1) as { name: string }).name;
    return [
      {
        file,
        kind: "route",
        pattern,
        methods: ["GET", "PATCH", "DELETE"],
        content: standaloneItemRoute(pattern, name),
      },
    ];
  }
  if (kind === "catchAll" || kind === "optionalCatchAll") {
    const name = (segments.at(-1) as { name: string }).name;
    return [
      { file, kind: "route", pattern, methods: ["GET"], content: catchAllRoute(pattern, name) },
    ];
  }

  // A resource: the data and handlers in api.ts files, plus the folder's schema.
  const names = resourceNames(last);
  const itemFilePath = `${normalized}/[${param}]/${ROUTE_FILE}`;
  const itemPattern = parseRoutePath(`${normalized}/[${param}]/api`, itemFilePath).pattern;
  const files: ScaffoldFile[] = [
    {
      file,
      kind: "route",
      pattern,
      methods: ["GET", "POST"],
      content: collectionRoute(pattern, names, ext),
    },
  ];
  if (options.item !== false) {
    files.push({
      file: itemFilePath,
      kind: "route",
      pattern: itemPattern,
      methods: ["GET", "PUT", "PATCH", "DELETE"],
      content: itemRoute(itemPattern, names, param, ext),
    });
  }
  files.push({
    file: `${normalized}/schema.ts`,
    kind: "helper",
    pattern: "",
    methods: [],
    content: folderSchemaFile(names.label),
  });
  return files;
}

/** How generated code should look in the project at `projectRoot`. */
export function detectProjectStyle(
  projectRoot: string,
): Pick<PlanOptions, "importExtension" | "quote"> {
  return {
    importExtension: detectImportExtension(projectRoot),
    quote: detectQuoteStyle(projectRoot),
  };
}

/** `single` when the project's Biome or Prettier config asks for single quotes. */
export function detectQuoteStyle(projectRoot: string): "double" | "single" {
  const read = (file: string) =>
    existsSync(join(projectRoot, file)) ? readFileSync(join(projectRoot, file), "utf8") : "";
  if (/"quoteStyle"\s*:\s*"single"/.test(read("biome.json"))) return "single";
  if (/"singleQuote"\s*:\s*true/.test(read(".prettierrc"))) return "single";
  return "double";
}

/**
 * `.ts` when the project's tsconfig allows importing `.ts` files (projects that
 * run TypeScript directly), `.js` when it has a tsconfig that doesn't (projects
 * compiled by plain `tsc`, such as NestJS), `.ts` when there's no tsconfig.
 */
export function detectImportExtension(projectRoot: string): ".ts" | ".js" {
  const tsconfig = join(projectRoot, "tsconfig.json");
  if (!existsSync(tsconfig)) return ".ts";
  const text = readFileSync(tsconfig, "utf8");
  return /"(allowImportingTsExtensions|rewriteRelativeImportExtensions)"\s*:\s*true/.test(text)
    ? ".ts"
    : ".js";
}

function normalizeFolder(folder: string): string {
  const normalized = folder
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
  if (normalized === "") throw new UsageError("give a resource name, e.g. `sabit add users`");
  if (normalized.split("/").includes("..")) {
    throw new UsageError("resource names can't contain '..'");
  }
  return normalized;
}

export interface ScaffoldResult {
  readonly created: ScaffoldFile[];
  /** Files that already existed and were left untouched. */
  readonly skipped: ScaffoldFile[];
}

/**
 * Writes planned files into `routesDir`. Existing files are never overwritten.
 * Before writing, the new files are checked against the existing route tree,
 * so a scaffold that would conflict (e.g. `users.ts` already exists) writes
 * nothing and throws a {@link RouteDefinitionError}.
 */
export async function writeScaffold(
  routesDir: string,
  files: readonly ScaffoldFile[],
): Promise<ScaffoldResult> {
  const created: ScaffoldFile[] = [];
  const skipped: ScaffoldFile[] = [];
  for (const file of files) {
    ((await exists(join(routesDir, file.file))) ? skipped : created).push(file);
  }

  await assertNoConflicts(routesDir, created);

  const written: ScaffoldFile[] = [];
  for (const file of created) {
    const target = join(routesDir, file.file);
    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(target, file.content, { flag: "wx" });
      written.push(file);
    } catch (error) {
      // Another watcher (dev and watch both running) wrote it first.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      skipped.push(file);
    }
  }
  return { created: written, skipped };
}

async function assertNoConflicts(routesDir: string, files: readonly ScaffoldFile[]) {
  if (files.length === 0) return;
  const existing = (await exists(routesDir))
    ? await scanRoutes(routesDir)
    : { routes: [], middleware: [] };
  const newFiles = new Set(files.filter((f) => f.kind === "route").map((f) => f.file));
  if (newFiles.size === 0) return;
  try {
    compileRoutes({
      routes: [...existing.routes.filter((r) => !newFiles.has(r)), ...newFiles],
      middleware: existing.middleware,
    });
  } catch (error) {
    if (!(error instanceof RouteDefinitionError)) throw error;
    const relevant: RouteProblem[] = error.problems.filter(
      (p) => newFiles.has(p.file) || [...newFiles].some((f) => p.message.includes(f)),
    );
    if (relevant.length > 0) throw new RouteDefinitionError(relevant);
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** An error caused by how the CLI was invoked; printed without a stack trace. */
export class UsageError extends Error {
  override name = "UsageError";
}
