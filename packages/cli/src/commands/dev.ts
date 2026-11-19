import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Command, Output } from "../command.ts";
import { resolveRoutesDir } from "../project.ts";
import { startRouteWatcher } from "../route-watcher.ts";

/** Entry files tried, in order, when none is given. */
const DEFAULT_ENTRIES = ["src/index.ts", "src/server.ts", "src/main.ts"];

export const dev: Command = {
  name: "dev",
  summary: "Run the server, restart on changes, and turn new route folders into endpoints",
  usage: `sabit dev [entry] [--run "<command>"] [--routes dir] [--no-scaffold]

  Starts your server with Node's watch mode (any change under the entry's
  folder restarts it). entry defaults to the first of ${DEFAULT_ENTRIES.join(", ")}.

  --run "<command>"  run your own dev command instead, e.g.
                     sabit dev --run "nest start --watch"

  While it runs, creating an empty folder in the routes directory, e.g.
      mkdir src/routes/products
  fills it with REST endpoints (same as \`sabit add products\`).
  Nested folders give nested URLs: src/routes/admin/metrics → /admin/metrics.

  If the project has src/sabit.route.ts (the generated route tree), it's kept
  up to date as route files are added, moved or removed.`,
  options: {
    run: { type: "string" },
    routes: { type: "string" },
    "no-scaffold": { type: "boolean" },
  },
  async run({ args, flags, cwd, out }) {
    const custom = flags.run as string | undefined;
    let entry: string | undefined;
    if (!custom) {
      entry = args[0]
        ? resolve(cwd, args[0])
        : DEFAULT_ENTRIES.map((e) => join(cwd, e)).find((e) => existsSync(e));
      if (!entry || !existsSync(entry)) {
        out.error(
          `Server entry not found${args[0] ? `: ${args[0]}` : ` (looked for ${DEFAULT_ENTRIES.join(", ")})`}. ` +
            'Pass it (sabit dev app.ts), use --run "<command>", or create a project with: sabit init',
        );
        return 1;
      }
    }

    const routesDir = resolveRoutesDir(cwd, flags.routes as string | undefined);
    const watcher = await startRouteWatcher({
      cwd,
      routesDir,
      out,
      scaffold: flags["no-scaffold"] !== true,
    });
    if (flags["no-scaffold"] !== true) {
      out.log(`Watching ${relative(cwd, routesDir) || "."}: create a folder to add endpoints.`);
    }

    const child = custom
      ? spawn(custom, { cwd, stdio: "inherit", shell: true })
      : spawn(process.execPath, ["--watch-path", dirname(entry as string), entry as string], {
          cwd,
          stdio: "inherit",
        });
    try {
      return await waitForExit(child, out);
    } finally {
      watcher.close();
    }
  },
};

/** Resolves with the child's exit code; Ctrl+C stops the child first. */
function waitForExit(child: ChildProcess, out: Output): Promise<number> {
  return new Promise((resolvePromise) => {
    const stop = () => child.kill("SIGTERM");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.on("error", (error) => {
      out.error(`Failed to start: ${error.message}`);
      resolvePromise(1);
    });
    child.on("exit", (code, signal) => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolvePromise(signal ? 0 : (code ?? 0));
    });
  });
}
