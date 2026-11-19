import { type FSWatcher, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";

// Whether a folder name is one the scaffolder fills (not private, not a route group).
export function isScaffoldable(folder: string): boolean {
  const last = folder.split("/").at(-1) ?? "";
  return last !== "" && !last.startsWith("_") && !last.startsWith(".") && !/^\(.*\)$/.test(last);
}

async function isEmptyDirectory(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isDirectory()) return false;
    return (await readdir(path)).length === 0;
  } catch {
    return false;
  }
}

// Empty, scaffoldable folders under `routesDir`, relative and `/`-separated.
export async function findEmptyFolders(routesDir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relative: string) => {
    const entries = await readdir(join(routesDir, relative), { withFileTypes: true });
    if (relative !== "" && entries.length === 0 && isScaffoldable(relative)) found.push(relative);
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith(".")) {
        await walk(relative ? `${relative}/${entry.name}` : entry.name);
      }
    }
  };
  await walk("");
  return found.sort();
}

export interface FolderWatcher {
  close(): void;
}

/*
 * Calls `onFolder` when a new, still-empty folder appears under `routesDir`.
 * Waits `delay` ms first, so folders created by tools that immediately add
 * files (editors, `git checkout`, the scaffolder itself) are left alone.
 */
export function watchNewFolders(
  routesDir: string,
  onFolder: (folder: string) => void | Promise<void>,
  options: { delay?: number } = {},
): FolderWatcher {
  const delay = options.delay ?? 300;
  const pending = new Map<string, NodeJS.Timeout>();

  const watcher: FSWatcher = watch(routesDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const folder = filename.toString().split(sep).join("/");
    if (!isScaffoldable(folder) || folder.split("/").some((p) => p.startsWith("_"))) return;
    clearTimeout(pending.get(folder));
    pending.set(
      folder,
      setTimeout(async () => {
        pending.delete(folder);
        if (await isEmptyDirectory(join(routesDir, folder))) await onFolder(folder);
      }, delay),
    );
  });

  return {
    close() {
      for (const timer of pending.values()) clearTimeout(timer);
      watcher.close();
    },
  };
}
