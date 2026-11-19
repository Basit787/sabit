import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMiddlewareFile, isModuleFileName, isPrivateName, isSchemaFile } from "../files.ts";
import { type ResolvedRoute, resolveRoutes } from "../resolve.ts";

export interface ScanResult {
  /** Route files relative to the routes directory, `/`-separated, sorted. */
  readonly routes: string[];
  /** Middleware files, same format. */
  readonly middleware: string[];
  /** Body schema files (`schema.ts`), same format. */
  readonly schemas: string[];
}

/**
 * Lists route and middleware files under `dir`. Skips `_`-prefixed files and
 * directories, declaration files and `*.test.*` / `*.spec.*` files.
 */
export async function scanRoutes(dir: string | URL): Promise<ScanResult> {
  const root = toPath(dir);
  await assertDirectory(root);

  const routes: string[] = [];
  const middleware: string[] = [];
  const schemas: string[] = [];

  const walk = async (relativeDir: string): Promise<void> => {
    const entries: Dirent[] = await readdir(join(root, relativeDir), { withFileTypes: true });
    for (const entry of entries) {
      if (isPrivateName(entry.name)) continue;
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const kind = entry.isSymbolicLink()
        ? await stat(join(root, relative)).then((s) => (s.isDirectory() ? "dir" : "file"))
        : entry.isDirectory()
          ? "dir"
          : "file";

      if (kind === "dir") {
        await walk(relative);
      } else if (isModuleFileName(entry.name)) {
        (isMiddlewareFile(relative) ? middleware : isSchemaFile(relative) ? schemas : routes).push(
          relative,
        );
      }
    }
  };

  await walk("");
  return { routes: routes.sort(), middleware: middleware.sort(), schemas: schemas.sort() };
}

export interface LoadRoutesOptions {
  /**
   * Imports a module by file URL. Defaults to native `import()`. Override it to
   * load through a custom loader.
   */
  import?: (url: string) => Promise<unknown>;
}

/**
 * Scans `dir`, imports every route and middleware module, and returns routes
 * ready to hand to an adapter.
 *
 * In development `dir` can point at TypeScript sources (Node 22.18+ strips
 * types natively; tsx and Bun work too). In production point it at compiled
 * output.
 *
 * ```ts
 * const routes = await loadRoutes(new URL("./routes", import.meta.url));
 * ```
 */
export async function loadRoutes(
  dir: string | URL,
  options: LoadRoutesOptions = {},
): Promise<ResolvedRoute[]> {
  const root = toPath(dir);
  const importModule = options.import ?? ((url: string) => import(url));
  const { routes, middleware, schemas } = await scanRoutes(root);
  const source = (file: string) => ({
    file,
    load: () => importModule(pathToFileURL(join(root, file)).href),
  });
  return resolveRoutes({
    routes: routes.map(source),
    middleware: middleware.map(source),
    schemas: schemas.map(source),
  });
}

function toPath(dir: string | URL): string {
  return resolve(typeof dir === "string" ? dir : fileURLToPath(dir));
}

async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path).catch(() => undefined);
  if (!info) throw new Error(`Routes directory not found: ${path}`);
  if (!info.isDirectory()) throw new Error(`Routes path is not a directory: ${path}`);
}
