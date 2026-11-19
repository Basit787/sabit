import { existsSync, watch } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { refreshRouteTree } from "./codegen.ts";
import type { Output } from "./command.ts";
import { report } from "./commands/add.ts";
import { detectProjectStyle, detectQuoteStyle, planScaffold, writeScaffold } from "./scaffold.ts";
import { folderSchemaFile } from "./templates.ts";
import { findEmptyFolders, watchNewFolders } from "./watch.ts";

export interface RouteWatcherOptions {
  readonly cwd: string;
  readonly routesDir: string;
  readonly out: Output;
  /** Fill new, empty folders with REST endpoints. Default `true`. */
  readonly scaffold?: boolean;
}

/**
 * Watches a routes folder: new empty folders get REST endpoints (like
 * `sabit add`) and `sabit.route.ts`, if the project has one, follows every
 * added, moved or removed route file. Used by `sabit dev` and `sabit watch`;
 * two of them running at once is harmless.
 */
export async function startRouteWatcher(options: RouteWatcherOptions): Promise<{ close(): void }> {
  const { cwd, routesDir, out } = options;
  const label = relative(cwd, routesDir) || ".";
  await mkdir(routesDir, { recursive: true });

  let folderWatcher: { close(): void } | undefined;
  if (options.scaffold !== false) {
    const scaffold = async (folder: string) => {
      try {
        const result = await writeScaffold(
          routesDir,
          planScaffold(folder, detectProjectStyle(cwd)),
        );
        // Another watcher (dev + watch) may have filled the folder first.
        report({ created: result.created, skipped: [] }, label, out);
      } catch (error) {
        out.error(`  could not scaffold ${label}/${folder}: ${(error as Error).message}`);
      }
    };
    for (const folder of await findEmptyFolders(routesDir)) await scaffold(folder);
    folderWatcher = watchNewFolders(routesDir, scaffold);
  }

  await refreshRouteTree(cwd, routesDir, out, { quiet: true });
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
        await removeStaleOutput(cwd, routesDir, paths, out);
      } catch (error) {
        out.error(`  route tree update failed: ${(error as Error).message}`);
      }
    }, 150);
  });

  return {
    close() {
      clearTimeout(pending);
      treeWatcher.close();
      folderWatcher?.close();
    },
  };
}

/**
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

/** A new, empty `schema.ts` in a routes folder gets a starter to fill in. */
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
  } catch {
    // Deleted again before we got to it.
  }
}
