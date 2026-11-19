import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findEmptyFolders, watchNewFolders } from "../src/index.ts";
import { tempProject } from "./helpers.ts";

const waitForAsync = async (check: () => Promise<boolean>, timeout = 3000) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const waitFor = async (check: () => boolean, timeout = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("findEmptyFolders", () => {
  it("finds empty folders, skipping groups and private folders", async () => {
    const dir = await tempProject();
    await mkdir(join(dir, "users"));
    await mkdir(join(dir, "orders/[id]"), { recursive: true });
    await mkdir(join(dir, "(admin)"));
    await mkdir(join(dir, "_lib"));
    await mkdir(join(dir, "posts"));
    await writeFile(join(dir, "posts/api.ts"), "");
    expect(await findEmptyFolders(dir)).toEqual(["orders/[id]", "users"]);
  });
});

describe("watchNewFolders", () => {
  it("reports new empty folders, including nested ones, and ignores the rest", async () => {
    const dir = await tempProject();
    const seen: string[] = [];
    const watcher = watchNewFolders(
      dir,
      (folder) => {
        seen.push(folder);
      },
      { delay: 100 },
    );
    try {
      // Native watchers (FSEvents on macOS) need a moment before they report events.
      await new Promise((r) => setTimeout(r, 200));
      await mkdir(join(dir, "products"));
      await mkdir(join(dir, "(admin)/settings"), { recursive: true });
      await mkdir(join(dir, "_private"));
      await mkdir(join(dir, "filled"));
      await writeFile(join(dir, "filled/api.ts"), "");
      await waitFor(() => seen.includes("products") && seen.includes("(admin)/settings"));
      await new Promise((r) => setTimeout(r, 250));
      expect(seen.sort()).toEqual(["(admin)/settings", "products"]);
    } finally {
      watcher.close();
    }
  });
});

describe("startRouteWatcher", () => {
  it("fills new folders and keeps the route tree current", async () => {
    const { startRouteWatcher } = await import("../src/index.ts");
    const { readFile } = await import("node:fs/promises");
    const root = await tempProject();
    const routesDir = join(root, "src/routes");
    await mkdir(routesDir, { recursive: true });
    await writeFile(join(root, "src/sabit.route.ts"), "");
    const lines: string[] = [];
    const watcher = await startRouteWatcher({
      cwd: root,
      routesDir,
      out: { log: (m) => lines.push(m), error: (m) => lines.push(m) },
    });
    try {
      await new Promise((r) => setTimeout(r, 200));
      await mkdir(join(routesDir, "products"));
      await waitFor(() => lines.some((l) => l.includes("products/schema.ts")), 5000);
      const tree = () => readFile(join(root, "src/sabit.route.ts"), "utf8");
      await waitForAsync(async () => (await tree()).includes('"/products/[id]"'), 5000);

      // Deleting the folder removes its routes from the tree.
      await rm(join(routesDir, "products"), { recursive: true });
      await waitForAsync(async () => !(await tree()).includes("/products"), 5000);
      expect(await tree()).toContain("export type RoutePattern = never;");
    } finally {
      watcher.close();
    }
  });

  it("fills an empty schema.ts with a starter", async () => {
    const { startRouteWatcher } = await import("../src/index.ts");
    const { readFile } = await import("node:fs/promises");
    const root = await tempProject();
    const routesDir = join(root, "src/routes");
    await mkdir(join(routesDir, "orders"), { recursive: true });
    await writeFile(join(routesDir, "orders/api.ts"), "export const GET = () => [];\n");
    const watcher = await startRouteWatcher({
      cwd: root,
      routesDir,
      out: { log: () => {}, error: () => {} },
    });
    try {
      await new Promise((r) => setTimeout(r, 200));
      await writeFile(join(routesDir, "orders/schema.ts"), "");
      await waitForAsync(
        async () =>
          (await readFile(join(routesDir, "orders/schema.ts"), "utf8")).includes("defineSchema"),
        5000,
      );
    } finally {
      watcher.close();
    }
  });

  it("doesn't fail when another watcher already filled the folder", async () => {
    const { planScaffold, writeScaffold } = await import("../src/index.ts");
    const dir = join(await tempProject(), "src/routes");
    const files = planScaffold("users");
    const [first, second] = await Promise.all([
      writeScaffold(dir, files),
      writeScaffold(dir, files),
    ]);
    expect(first.created.length + second.created.length).toBe(files.length);
  });
});
