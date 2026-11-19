import { existsSync, readFileSync, watch } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { ENV_FILES, refreshEnvFile, refreshRouteTree } from "./codegen.ts";
import type { Output } from "./command.ts";
import { addRouteTests, report } from "./commands/add.ts";
import {
  addAccessRules,
  DOCS_RESERVED,
  detectAlias,
  detectImportExtension,
  detectProjectStyle,
  detectQuoteStyle,
  hasAccessList,
  hasAppMiddleware,
  listAllRoutes,
  planScaffold,
  servesDocs,
  writeScaffold,
} from "./scaffold.ts";
import { detectOrm, REPOSITORY_PATTERN_SUFFIX, repositoryPatternFile } from "./stack.ts";
import { appMiddlewareFile, folderMiddlewareFile, folderSchemaFile } from "./templates.ts";
import { findEmptyFolders, watchNewFolders } from "./watch.ts";

// The project and routes folder, where to print, and `scaffold` (fill new empty folders; default true).
export interface RouteWatcherOptions {
  readonly cwd: string;
  readonly routesDir: string;
  readonly out: Output;
  readonly scaffold?: boolean;
}

/*
 * Watches the routes folder for `sabit dev` and `sabit watch`: new empty folders get endpoints, the route
 * tree follows every change, src/env.ts follows .env, and empty middleware.ts and *.repository.pattern.ts
 * files get starters. Two watchers running at once is harmless.
 */
export async function startRouteWatcher(options: RouteWatcherOptions): Promise<{ close(): void }> {
  const { cwd, routesDir, out } = options;
  const label = relative(cwd, routesDir) || ".";
  await mkdir(routesDir, { recursive: true });

  let folderWatcher: { close(): void } | undefined;
  if (options.scaffold !== false) {
    const scaffold = async (folder: string) => {
      try {
        const central = hasAccessList(routesDir);
        const style = detectProjectStyle(cwd);
        const files = planScaffold(folder, {
          ...style,
          auth: central || hasAppMiddleware(routesDir),
          authIn: central ? "middleware" : "route",
        });
        if (servesDocs(files)) {
          await removeDocsFolder(cwd, routesDir, folder, out);
          return;
        }
        const result = await writeScaffold(routesDir, files);
        report({ created: result.created, skipped: [] }, label, out);
        if (central && (await addAccessRules(routesDir, result.created, style.quote))) {
          out.log(`  updated  ${relative(cwd, join(dirname(routesDir), "middleware.ts"))}`);
        }
        await addRouteTests(cwd, routesDir, result.created, out);
      } catch (error) {
        out.error(`  could not scaffold ${label}/${folder}: ${(error as Error).message}`);
      }
    };
    for (const folder of await findEmptyFolders(routesDir)) await scaffold(folder);
    folderWatcher = watchNewFolders(routesDir, scaffold);
  }

  await refreshRouteTree(cwd, routesDir, out, { quiet: true });
  await listRoutesInMiddleware(cwd, routesDir, out);

  const updateEnv = () =>
    refreshEnvFile(cwd, routesDir, out).catch((error: Error) =>
      out.error(`  src/env.ts update failed: ${error.message}`),
    );
  await updateEnv();
  let envPending: NodeJS.Timeout | undefined;
  const envWatcher = watch(cwd, (_event, filename) => {
    if (!filename || !ENV_FILES.includes(filename.toString())) return;
    clearTimeout(envPending);
    envPending = setTimeout(updateEnv, 100);
  });

  const srcDir = dirname(routesDir);
  const repositoryWatcher = watch(srcDir, { recursive: true }, (_event, filename) => {
    const name = filename?.toString();
    if (name?.endsWith(REPOSITORY_PATTERN_SUFFIX)) {
      void fillEmptyRepositoryPattern(cwd, srcDir, name, out);
    } else if (name && basename(name) === "middleware.ts") {
      const file = join(srcDir, name);
      void fillEmptyFile(
        cwd,
        file,
        dirname(file) === srcDir
          ? appMiddlewareFile([], detectImportExtension(cwd))
          : folderMiddlewareFile(),
        out,
      );
    }
  });

  let pending: NodeJS.Timeout | undefined;
  const changed = new Set<string>();
  const treeWatcher = watch(routesDir, { recursive: true }, (_event, filename) => {
    if (filename) {
      changed.add(filename.toString());
      void fillEmptySchema(cwd, routesDir, filename.toString(), out);
    }
    clearTimeout(pending);
    pending = setTimeout(async () => {
      const paths = [...changed];
      changed.clear();
      try {
        await refreshRouteTree(cwd, routesDir, out, { quiet: true });
        await listRoutesInMiddleware(cwd, routesDir, out);
        await removeStaleOutput(cwd, routesDir, paths, out);
      } catch (error) {
        out.error(`  route tree update failed: ${(error as Error).message}`);
      }
    }, 150);
  });

  return {
    close() {
      clearTimeout(pending);
      clearTimeout(envPending);
      treeWatcher.close();
      envWatcher.close();
      repositoryWatcher.close();
      folderWatcher?.close();
    },
  };
}

/*
 * A new routes/docs folder (the URL of the built-in API docs) is removed while it holds no files;
 * one with files is left for you, and the route tree reports it.
 */
async function removeDocsFolder(
  cwd: string,
  routesDir: string,
  folder: string,
  out: Output,
): Promise<void> {
  const parts = folder.split(/[\\/]/);
  const docsAt = parts.findIndex((part) => !/^\(.*\)$/.test(part));
  const top = join(routesDir, ...parts.slice(0, docsAt + 1));
  const files = await readdir(top, { recursive: true, withFileTypes: true });
  if (files.some((entry) => !entry.isDirectory())) {
    out.error(`  ${relative(cwd, top)}: ${DOCS_RESERVED}`);
    return;
  }
  await rm(top, { recursive: true, force: true });
  out.log(`  removed  ${relative(cwd, top)}: ${DOCS_RESERVED}`);
}

/*
 * NestJS compiles `src/` into `dist/` and its watch mode never deletes the
 * output of a deleted source, so a deleted route folder would linger in
 * `dist/routes`. Remove the compiled copies of deleted route paths.
 */
async function removeStaleOutput(
  cwd: string,
  routesDir: string,
  changedPaths: readonly string[],
  out: Output,
): Promise<void> {
  if (!existsSync(join(cwd, "nest-cli.json"))) return;
  const outRoutes = join(cwd, "dist", relative(join(cwd, "src"), routesDir));
  for (const path of changedPaths) {
    if (existsSync(join(routesDir, path))) continue;
    const compiled = join(outRoutes, path).replace(/\.ts$/, "");
    const candidates = [
      compiled,
      ...[".js", ".js.map", ".d.ts", ".d.ts.map"].map((e) => compiled + e),
    ];
    for (const candidate of candidates) {
      if (!candidate.startsWith(outRoutes + sep) || !existsSync(candidate)) continue;
      await rm(candidate, { recursive: true, force: true });
      out.log(`  removed  ${relative(cwd, candidate)}`);
    }
  }
}

// A new, empty schema.ts in a routes folder gets a starter (a file deleted meanwhile is skipped).
async function fillEmptySchema(
  cwd: string,
  routesDir: string,
  path: string,
  out: Output,
): Promise<void> {
  if (!/(^|[\\/])schema\.ts$/.test(path)) return;
  const file = join(routesDir, path);
  try {
    if ((await stat(file)).size !== 0) return;
    const source = folderSchemaFile();
    await writeFile(
      file,
      detectQuoteStyle(cwd) === "single" ? source.replaceAll('"', "'") : source,
    );
    out.log(`  filled   ${relative(cwd, file)}`);
  } catch {}
}

/*
 * A new, empty <name>.repository.pattern.ts gets the repository for that model (a file deleted
 * meanwhile is skipped).
 */
async function fillEmptyRepositoryPattern(
  cwd: string,
  srcDir: string,
  path: string,
  out: Output,
): Promise<void> {
  const file = join(srcDir, path);
  try {
    if ((await stat(file)).size !== 0) return;
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const orm = detectOrm(pkg.dependencies ?? {});
    if (!orm) {
      out.error(
        `  ${relative(cwd, file)}: no database ORM in package.json to build a repository on`,
      );
      return;
    }
    const alias = detectAlias(cwd);
    const from = (target: string) => {
      if (alias) return `#src/${target}`;
      const path = relative(dirname(file), join(srcDir, target)).split(sep).join("/");
      return path.startsWith(".") ? path : `./${path}`;
    };
    const base = (path.split(/[\\/]/).at(-1) as string).slice(0, -REPOSITORY_PATTERN_SUFFIX.length);
    const source = repositoryPatternFile(
      orm,
      base,
      { repository: from("db/repository"), models: from("db/models") },
      detectImportExtension(cwd),
    );
    await writeFile(
      file,
      detectQuoteStyle(cwd) === "single" ? source.replaceAll('"', "'") : source,
    );
    out.log(`  filled   ${relative(cwd, file)}`);
  } catch {}
}

// Writes `source` into `file` if it's empty, in the project's quote style (skips a file deleted meanwhile).
async function fillEmptyFile(
  cwd: string,
  file: string,
  source: string,
  out: Output,
): Promise<void> {
  try {
    if ((await stat(file)).size !== 0) return;
    await writeFile(
      file,
      detectQuoteStyle(cwd) === "single" ? source.replaceAll('"', "'") : source,
    );
    out.log(`  filled   ${relative(cwd, file)}`);
  } catch {}
}

// Adds routes missing from src/middleware.ts's access list (as public) and says so.
export async function listRoutesInMiddleware(
  cwd: string,
  routesDir: string,
  out: Output,
): Promise<void> {
  if (await listAllRoutes(routesDir, detectQuoteStyle(cwd))) {
    out.log(`  updated  ${relative(cwd, join(dirname(routesDir), "middleware.ts"))}`);
  }
}
