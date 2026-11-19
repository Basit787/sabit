import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMiddlewareFile, isModuleFileName, isPrivateName, isSchemaFile } from "../files.ts";
import { type ResolvedRoute, resolveRoutes } from "../resolve.ts";

// Route, middleware and schema.ts files found under the routes folder: relative, `/`-separated, sorted.
export interface ScanResult {
  readonly routes: string[];
  readonly middleware: string[];
  readonly schemas: string[];
}

/*
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

// `importModule` loads a module by file URL: native import() by default, override it for a custom loader.
export interface LoadRoutesOptions {
  import?: (url: string) => Promise<unknown>;
}

/*
 * Scans `dir`, imports every route and middleware module and returns routes for an adapter. Point it
 * at TypeScript sources in development (Node 22.18+, tsx, Bun) and at compiled output in production.
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
