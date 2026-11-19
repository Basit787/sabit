/** File extensions recognized as route or middleware modules. */
export const MODULE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const;

const EXTENSION = /\.(?:[cm]?[jt]s)$/;
/** Base name (without extension) reserved for middleware files. */
export const MIDDLEWARE_BASENAME = "middleware";

/**
 * Whether a file name (not a path) is a route or middleware module.
 *
 * Skipped, so they can live next to routes:
 * - names with a dot before the extension: `users.service.ts`, `user.dto.ts`,
 *   `api.test.ts`, `types.d.ts`
 * - `_`-prefixed private files: `_helpers.ts`
 */
export function isModuleFileName(name: string): boolean {
  if (!EXTENSION.test(name) || isPrivateName(name)) return false;
  // Dots inside [...catchAll] / [[...optional]] segments don't count.
  return !stripExtension(name)
    .replace(/\[[^\]]*\]+/g, "")
    .includes(".");
}

/** `_`-prefixed files and directories are private: never routes, never scanned. */
export function isPrivateName(name: string): boolean {
  return name.startsWith("_");
}

export function stripExtension(file: string): string {
  return file.replace(EXTENSION, "");
}

export function isMiddlewareFile(file: string): boolean {
  const base = stripExtension(file).split("/").pop();
  return base === MIDDLEWARE_BASENAME;
}

/** Directory of a relative `/`-separated path; `""` for the routes root. */
export function dirnameOf(file: string): string {
  const index = file.lastIndexOf("/");
  return index === -1 ? "" : file.slice(0, index);
}

/** Base name (without extension) reserved for a folder's body schema. */
export const SCHEMA_BASENAME = "schema";

/** `schema.ts` in a routes folder: validates request bodies for routes in that folder and below. */
export function isSchemaFile(file: string): boolean {
  return stripExtension(file).split("/").pop() === SCHEMA_BASENAME;
}
