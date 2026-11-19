import { relative } from "node:path";
import type { Command } from "../command.ts";
import { resolveRoutesDir } from "../project.ts";
import { startRouteWatcher } from "../route-watcher.ts";

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
    const routesDir = resolveRoutesDir(cwd, flags.routes as string | undefined);
    const watcher = await startRouteWatcher({ cwd, routesDir, out });
    out.log(`Watching ${relative(cwd, routesDir) || "."}: create a folder to add endpoints.`);
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    watcher.close();
    return 0;
  },
};
