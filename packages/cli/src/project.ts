import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The routes directory: `--routes` if given, else `src/routes`, else `routes`
 * (whichever exists), defaulting to `src/routes`.
 */
export function resolveRoutesDir(cwd: string, flag?: string): string {
  if (flag) return resolve(cwd, flag);
  for (const candidate of ["src/routes", "routes"]) {
    if (existsSync(join(cwd, candidate))) return join(cwd, candidate);
  }
  return join(cwd, "src/routes");
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** The package manager that launched this process, from `npm_config_user_agent`. */
export function detectPackageManager(env: NodeJS.ProcessEnv = process.env): PackageManager {
  const agent = env.npm_config_user_agent ?? "";
  if (agent.startsWith("pnpm")) return "pnpm";
  if (agent.startsWith("yarn")) return "yarn";
  if (agent.startsWith("bun")) return "bun";
  return "npm";
}

/** Command that runs a package script, e.g. `pnpm dev` or `npm run dev`. */
export function runScript(pm: PackageManager, script: string): string {
  return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
}

/**
 * If `dir` is inside the sabit repository itself, returns the repo root.
 * Projects created there depend on the local packages (`workspace:*`).
 */
export function findSabitRepo(dir: string): string | undefined {
  let current = resolve(dir);
  for (;;) {
    const manifest = join(current, "packages/router/package.json");
    if (existsSync(join(current, "pnpm-workspace.yaml")) && existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, "utf8")).name === "@sabit/router") {
          return current;
        }
      } catch {
        // not ours
      }
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** This CLI's own version. */
export function cliVersion(): string {
  const manifest = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
}

/** Command that runs this CLI from a project, e.g. `pnpm sabit` or `npx sabit`. */
export function execBin(pm: PackageManager): string {
  return {
    npm: "npx sabit",
    pnpm: "pnpm sabit",
    yarn: "yarn sabit",
    bun: "bunx sabit",
  }[pm];
}
