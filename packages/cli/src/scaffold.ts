import { existsSync, readFileSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import {
  compileRoutes,
  type HttpMethod,
  parseRoutePath,
  RouteDefinitionError,
  type RouteProblem,
  type Segment,
} from "@sabit/router";
import { scanRoutes } from "@sabit/router/fs";
import type { AuthKind } from "./auth-files.ts";
import { routeTreePath } from "./codegen.ts";
import {
  ACCESS_MARKER,
  catchAllRoute,
  catchAllRouteTest,
  collectionRoute,
  collectionRouteTest,
  folderSchemaFile,
  itemRoute,
  itemRouteTest,
  requestHelperFile,
  resourceNames,
  standaloneItemRoute,
  standaloneItemRouteTest,
  type TestLocation,
} from "./templates.ts";

// The file name generated for each endpoint folder.
export const ROUTE_FILE = "api.ts";

/*
 * A generated file: `file` relative to the routes folder; `kind` route (with `pattern` and `methods`) or
 * helper; its `test`, written under test/routes; and `access`, its rule for the access list.
 */
export interface ScaffoldFile {
  readonly file: string;
  readonly kind: "route" | "helper";
  readonly pattern: string;
  readonly methods: readonly HttpMethod[];
  readonly content: string;
  readonly test?: string;
  readonly access?: string;
}

/*
 * `param` (default id), `item` route (default true), import extension (.ts, or .js for tsc/NestJS), `quote`,
 * `alias` (#src/ imports), `auth` (protect writes, default true) and `authIn` ("route" export or
 * "middleware" access list).
 */
export interface PlanOptions {
  readonly param?: string;
  readonly item?: boolean;
  readonly importExtension?: ".ts" | ".js";
  readonly quote?: "double" | "single";
  readonly alias?: boolean;
  readonly auth?: boolean;
  readonly authIn?: "route" | "middleware";
}

/*
 * Files for a folder: `users` → users/api.ts + users/[id]/api.ts + schema.ts; `users/[id]` → an item
 * route; `files/[...path]` → a GET route. Throws for route groups, `_` folders and invalid names.
 */
export function planScaffold(folder: string, options: PlanOptions = {}): ScaffoldFile[] {
  const files = planFiles(folder, options);
  if (options.quote !== "single") return files;
  return files.map((file) => ({
    ...file,
    content: file.content.replaceAll('"', "'"),
    ...(file.test ? { test: file.test.replaceAll('"', "'") } : {}),
  }));
}

/*
 * The files of planScaffold, before quote conversion: a resource gets its data and handlers in api.ts
 * files plus the folder's schema.
 */
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

  const ext = options.importExtension ?? ".ts";
  const { pattern, segments } = parseRoutePath(`${normalized}/api`, `${normalized}/${ROUTE_FILE}`);
  const param = options.param ?? itemParam(segments, last);
  const auth = options.auth ?? true;
  const inRoute = auth && options.authIn !== "middleware";
  const access = (value: string) => (auth ? { access: value } : {});
  const kind = segments.at(-1)?.kind;
  const file = `${normalized}/${ROUTE_FILE}`;
  const at = (routeFile: string): TestLocation =>
    testLocation(routeFile, ext, undefined, options.alias);

  if (kind === "dynamic") {
    const name = (segments.at(-1) as { name: string }).name;
    return [
      {
        file,
        kind: "route",
        pattern,
        methods: ["GET", "PATCH", "DELETE"],
        content: standaloneItemRoute(pattern, name, inRoute),
        ...access(STANDALONE_ACCESS),
        test: standaloneItemRouteTest(pattern, name, at(file)),
      },
    ];
  }
  if (kind === "catchAll" || kind === "optionalCatchAll") {
    const name = (segments.at(-1) as { name: string }).name;
    return [
      {
        file,
        kind: "route",
        pattern,
        methods: ["GET"],
        content: catchAllRoute(pattern, name),
        test: catchAllRouteTest(pattern, name, at(file)),
      },
    ];
  }

  const names = resourceNames(last);
  const itemFilePath = `${normalized}/[${param}]/${ROUTE_FILE}`;
  const itemPattern = parseRoutePath(`${normalized}/[${param}]/api`, itemFilePath).pattern;
  const files: ScaffoldFile[] = [
    {
      file,
      kind: "route",
      pattern,
      methods: ["GET", "POST"],
      content: collectionRoute(pattern, names, inRoute),
      ...access(COLLECTION_ACCESS),
      test: collectionRouteTest(pattern, names.label, at(file), auth),
    },
  ];
  if (options.item !== false) {
    files.push({
      file: itemFilePath,
      kind: "route",
      pattern: itemPattern,
      methods: ["GET", "PUT", "PATCH", "DELETE"],
      content: itemRoute(itemPattern, names, param, ext, inRoute),
      ...access(ITEM_ACCESS),
      test: itemRouteTest(itemPattern, names.label, at(itemFilePath)),
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

/*
 * The item param for a collection: `id`, unless a parent folder already uses
 * it (`users/[id]/posts`), then `postId`, since a path can't repeat a param.
 */
function itemParam(segments: readonly Segment[], folder: string): string {
  const taken = new Set(segments.flatMap((s) => ("name" in s ? [s.name] : [])));
  if (!taken.has("id")) return "id";
  const { entity } = resourceNames(folder);
  const base = `${entity[0]?.toLowerCase()}${entity.slice(1)}Id`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
  return name;
}

/*
 * Where a route file's test reaches `test/request.ts` from: `users/api.ts` is
 * tested by `test/routes/users/api.test.ts`. `mock` is a project-relative module.
 */
export function testLocation(
  routeFile: string,
  ext: string,
  mock?: string,
  alias = false,
): TestLocation {
  if (alias) {
    return { helper: "#test/request", ext, mock: mock?.replace(/^src\//, "#src/") };
  }
  const up = "../".repeat(routeFile.split("/").length);
  return { helper: `${up}request`, ext, mock: mock && `${up}../${mock}` };
}

// The project's kind of auth, from the files in src/ (src/auth.ts in projects from before src/auth/).
export function detectAuthKind(srcDir: string): AuthKind | undefined {
  if (existsSync(join(srcDir, "auth/better-auth.ts"))) return "better-auth";
  if (existsSync(join(srcDir, "auth/utils/jwt.ts"))) return "jwt";
  const legacy = join(srcDir, "auth.ts");
  return existsSync(legacy) && readFileSync(legacy, "utf8").includes("jose") ? "jwt" : undefined;
}

/*
 * Writes new routes' tests to test/routes/ (.spec.ts in NestJS) and the shared test/request.ts, whose
 * admin token matches the app's auth (src/auth/). Keeps existing files; returns what it wrote.
 */
export async function writeRouteTests(
  projectRoot: string,
  routesDir: string,
  files: readonly ScaffoldFile[],
): Promise<string[]> {
  const suffix = existsSync(join(projectRoot, "nest-cli.json")) ? ".spec.ts" : ".test.ts";
  const ext = detectImportExtension(projectRoot);
  const treePath = detectAlias(projectRoot)
    ? `#src/${relative(dirname(routesDir), routeTreePath(routesDir))}`
    : relative(join(projectRoot, "test"), routeTreePath(routesDir));
  const treeImport = treePath.split(sep).join("/").replace(/\.ts$/, ext);
  const helper = requestHelperFile(treeImport, detectAuthKind(dirname(routesDir)));
  const planned: Array<[string, string]> = [
    [
      "test/request.ts",
      detectQuoteStyle(projectRoot) === "single" ? helper.replaceAll('"', "'") : helper,
    ],
  ];
  for (const file of files) {
    if (file.test)
      planned.push([posix.join("test/routes", file.file.replace(/\.ts$/, suffix)), file.test]);
  }
  if (planned.length === 1) return [];
  const written: string[] = [];
  for (const [file, content] of planned) {
    const target = join(projectRoot, file);
    if (existsSync(target)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    written.push(file);
  }
  return written;
}

// Default rules of generated routes: writes need a signed-in user, deletes an admin.
export const COLLECTION_ACCESS = "{ POST: true }";
export const ITEM_ACCESS = '{ PUT: true, PATCH: true, DELETE: "admin" }';
const STANDALONE_ACCESS = '{ PATCH: true, DELETE: "admin" }';

// Whether src/middleware.ts keeps the access list that generated routes are added to.
export function hasAccessList(routesDir: string): boolean {
  const file = join(dirname(routesDir), "middleware.ts");
  return existsSync(file) && readFileSync(file, "utf8").includes(ACCESS_MARKER);
}

/*
 * Adds each new route's rule to the access list in src/middleware.ts, above its
 * marker line; routes already listed are left as they are. Returns whether the
 * file changed.
 */
export async function addAccessRules(
  routesDir: string,
  files: readonly ScaffoldFile[],
  quote: "double" | "single" = "double",
): Promise<boolean> {
  const entries = files.flatMap((f) =>
    f.kind === "route" && f.access ? [[f.pattern, f.access] as const] : [],
  );
  return addAccessEntries(routesDir, entries, quote);
}

/*
 * Keeps the access list in src/middleware.ts in step with the routes: new ones (\`/\`, routes written by
 * hand) are added as public (\`false\`), deleted ones are removed; other rules are kept. Nothing changes
 * while the routes have problems. Returns whether the file changed.
 */
export async function listAllRoutes(
  routesDir: string,
  quote: "double" | "single" = "double",
): Promise<boolean> {
  if (!hasAccessList(routesDir)) return false;
  const patterns = await routePatternsOrUndefined(routesDir);
  if (!patterns) return false;
  const removed = await removeAccessEntries(routesDir, (pattern) => !patterns.includes(pattern));
  const added = await addAccessEntries(
    routesDir,
    patterns.map((pattern) => [pattern, "false"] as const),
    quote,
  );
  return removed || added;
}

/*
 * Removes the access list entries (one line each, before the marker line) whose pattern `drop` picks.
 * Returns whether the file changed.
 */
export async function removeAccessEntries(
  routesDir: string,
  drop: (pattern: string) => boolean,
): Promise<boolean> {
  const file = join(dirname(routesDir), "middleware.ts");
  if (!existsSync(file)) return false;
  const source = readFileSync(file, "utf8");
  const marker = source.indexOf(ACCESS_MARKER);
  const open = source.search(/\bconst access\b/);
  if (marker === -1 || open === -1 || open > marker) return false;
  const head = source.slice(0, open);
  const list = source.slice(open, marker);
  const kept = list
    .split("\n")
    .filter((line) => {
      const entry = /^\s*(["'])(\/[^"']*)\1:.*,\s*(\/\/.*)?$/.exec(line);
      return !entry || !drop(entry[2] as string);
    })
    .join("\n");
  if (kept === list) return false;
  await writeFile(file, head + kept + source.slice(marker));
  return true;
}

// What `sabit add` and the watcher say for a /docs folder: that URL is the built-in API docs.
export const DOCS_RESERVED =
  "/docs is the built-in API docs; pick another name (nested folders such as products/docs are fine)";

// Whether planned files would serve /docs or below, which the built-in API docs own.
export function servesDocs(files: readonly ScaffoldFile[]): boolean {
  return files.some((file) => file.kind === "route" && /^\/docs(\/|$)/i.test(file.pattern));
}

// The URL patterns of every route under `routesDir`, in matching order; [] when it has problems.
export async function routePatterns(routesDir: string): Promise<string[]> {
  return (await routePatternsOrUndefined(routesDir)) ?? [];
}

async function routePatternsOrUndefined(routesDir: string): Promise<string[] | undefined> {
  try {
    const { routes, middleware } = await scanRoutes(routesDir);
    return compileRoutes({ routes, middleware }).map((route) => route.pattern);
  } catch {
    return undefined;
  }
}

/*
 * Changes one route's rule in the access list of src/middleware.ts, but only while it's still one
 * of `from` (a rule sabit wrote): rules you changed are kept. Returns whether the file changed.
 */
export async function replaceAccessRule(
  routesDir: string,
  pattern: string,
  from: readonly string[],
  to: string,
  quote: "double" | "single" = "double",
): Promise<boolean> {
  const file = join(dirname(routesDir), "middleware.ts");
  if (!existsSync(file)) return false;
  const source = readFileSync(file, "utf8");
  const q = quote === "single" ? "'" : '"';
  const style = (rule: string) => (quote === "single" ? rule.replaceAll('"', "'") : rule);
  for (const rule of from) {
    const line = `${q}${pattern}${q}: ${style(rule)},`;
    if (source.includes(line)) {
      await writeFile(file, source.replace(line, `${q}${pattern}${q}: ${style(to)},`));
      return true;
    }
  }
  return false;
}

async function addAccessEntries(
  routesDir: string,
  entries: ReadonlyArray<readonly [string, string]>,
  quote: "double" | "single",
): Promise<boolean> {
  const file = join(dirname(routesDir), "middleware.ts");
  if (!existsSync(file)) return false;
  const source = readFileSync(file, "utf8");
  const marker = source.indexOf(ACCESS_MARKER);
  if (marker === -1) return false;
  const q = quote === "single" ? "'" : '"';
  const lines = entries
    .filter(([pattern]) => !source.includes(`${q}${pattern}${q}:`))
    .map(([pattern, rule]) => {
      const value = quote === "single" ? rule.replaceAll('"', "'") : rule;
      return `${q}${pattern}${q}: ${value},`;
    });
  if (lines.length === 0) return false;
  const lineStart = source.lastIndexOf("\n", marker) + 1;
  const indent = source.slice(lineStart, marker);
  const added = lines.map((line) => `${indent}${line}\n`).join("");
  await writeFile(file, source.slice(0, lineStart) + added + source.slice(lineStart));
  return true;
}

// Whether the project has src/middleware.ts (next to the routes), which generated `auth` needs.
export function hasAppMiddleware(routesDir: string): boolean {
  return existsSync(join(dirname(routesDir), "middleware.ts"));
}

// How generated code should look in the project at `projectRoot`.
export function detectProjectStyle(
  projectRoot: string,
): Pick<PlanOptions, "importExtension" | "quote" | "alias"> {
  return {
    importExtension: detectImportExtension(projectRoot),
    quote: detectQuoteStyle(projectRoot),
    alias: detectAlias(projectRoot),
  };
}

/*
 * Whether the project has the #src/ and #test/ import aliases (package.json
 * "imports"), so generated code can use them instead of ../../ paths.
 */
export function detectAlias(projectRoot: string): boolean {
  const file = join(projectRoot, "package.json");
  if (!existsSync(file)) return false;
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { imports?: Record<string, unknown> };
  return pkg.imports?.["#src/*"] !== undefined && pkg.imports["#test/*"] !== undefined;
}

// `single` when the project's Biome or Prettier config asks for single quotes.
export function detectQuoteStyle(projectRoot: string): "double" | "single" {
  const read = (file: string) =>
    existsSync(join(projectRoot, file)) ? readFileSync(join(projectRoot, file), "utf8") : "";
  if (/"quoteStyle"\s*:\s*"single"/.test(read("biome.json"))) return "single";
  if (/"singleQuote"\s*:\s*true/.test(read(".prettierrc"))) return "single";
  return "double";
}

/*
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

// What writeScaffold did: files `created`, and files `skipped` because they already existed.
export interface ScaffoldResult {
  readonly created: ScaffoldFile[];
  readonly skipped: ScaffoldFile[];
}

/*
 * Writes the planned files, never overwriting (a file another watcher wrote first counts as skipped).
 * If they'd conflict with the existing routes, nothing is written and a RouteDefinitionError is thrown.
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

// An error caused by how the CLI was invoked; printed without a stack trace.
export class UsageError extends Error {
  override name = "UsageError";
}
