// File extensions recognized as route or middleware modules.
export const MODULE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const;

const EXTENSION = /\.(?:[cm]?[jt]s)$/;
// Base name (without extension) reserved for middleware files.
export const MIDDLEWARE_BASENAME = "middleware";

/*
 * Whether a file name is a route or middleware module. Names with a dot before the extension
 * (users.service.ts, api.test.ts) and `_` files are skipped; dots inside [...x] / [[...x]] don't count.
 */
export function isModuleFileName(name: string): boolean {
  if (!EXTENSION.test(name) || isPrivateName(name)) return false;
  return !stripExtension(name)
    .replace(/\[[^\]]*\]+/g, "")
    .includes(".");
}

// `_`-prefixed files and directories are private: never routes, never scanned.
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

// Directory of a relative `/`-separated path; `""` for the routes root.
export function dirnameOf(file: string): string {
  const index = file.lastIndexOf("/");
  return index === -1 ? "" : file.slice(0, index);
}

// Base name (without extension) reserved for a folder's body schema.
export const SCHEMA_BASENAME = "schema";

// `schema.ts` in a routes folder: validates request bodies for routes in that folder and below.
export function isSchemaFile(file: string): boolean {
  return stripExtension(file).split("/").pop() === SCHEMA_BASENAME;
}
