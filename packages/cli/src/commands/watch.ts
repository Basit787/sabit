import type { Command } from "../command.ts";
import { isProduction, resolveRoutesDir } from "../project.ts";
import { startRouteWatcher } from "../route-watcher.ts";

/*
 * `sabit watch`: the route watcher without the server. Silent until a change: it only prints the files
 * it creates or updates. Refuses in production.
 */
export const watch: Command = {
  name: "watch",
  summary: "Turn new route folders into endpoints, without running the server",
  usage: `sabit watch [--routes dir]

  Watches the routes directory until stopped (Ctrl+C):
    - a new, empty folder is filled with REST endpoints (same as \`sabit add\`)
    - src/sabit.route.ts follows every added, moved or removed route file

  New projects start it automatically when opened in VS Code
  (.vscode/tasks.json). \`sabit dev\` does the same while it runs.`,
  options: { routes: { type: "string" } },
  async run({ flags, cwd, out }) {
    if (isProduction("watch", out)) return 1;
    const routesDir = resolveRoutesDir(cwd, flags.routes as string | undefined);
    const watcher = await startRouteWatcher({ cwd, routesDir, out });
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    watcher.close();
    return 0;
  },
};
