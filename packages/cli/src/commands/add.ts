import { posix, relative } from "node:path";
import { refreshRouteTree } from "../codegen.ts";
import type { Command, Output } from "../command.ts";
import { resolveRoutesDir } from "../project.ts";
import {
  detectProjectStyle,
  planScaffold,
  type ScaffoldResult,
  writeScaffold,
} from "../scaffold.ts";
import { displayPath } from "../templates.ts";

export const add: Command = {
  name: "add",
  summary: "Create REST endpoints for a resource (users → /users and /users/:id)",
  usage: `sabit add <resource...> [--param id] [--no-item] [--routes dir]

  Creates, for e.g. \`sabit add users\`:
    routes/users/api.ts        GET (list), POST (create) + sample data
    routes/users/[id]/api.ts   GET, PUT, PATCH, DELETE
    routes/users/schema.ts     what a user looks like; POST/PUT/PATCH bodies are checked

  Who may call what is decided in src/middleware.ts.

  Examples:
    sabit add users
    sabit add users posts comments
    sabit add admin/settings --no-item
    sabit add users/[userId]/posts
    sabit add products --param sku

  Existing files are never overwritten.`,
  options: {
    param: { type: "string" },
    "no-item": { type: "boolean" },
    routes: { type: "string" },
  },
  async run({ args, flags, cwd, out }) {
    if (args.length === 0) {
      out.error("Missing resource name. Example: sabit add users");
      return 1;
    }
    const routesDir = resolveRoutesDir(cwd, flags.routes as string | undefined);
    for (const resource of args) {
      const files = planScaffold(resource, {
        param: (flags.param as string | undefined) ?? "id",
        item: flags["no-item"] !== true,
        ...detectProjectStyle(cwd),
      });
      report(await writeScaffold(routesDir, files), relative(cwd, routesDir) || ".", out);
    }
    await refreshRouteTree(cwd, routesDir, out, { quiet: true });
    return 0;
  },
};

/** Prints what a scaffold created or skipped. Shared with `dev`. */
export function report(result: ScaffoldResult, routesLabel: string, out: Output): void {
  for (const file of result.created) {
    const route =
      file.kind === "route" ? `  →  ${file.methods.join(", ")} ${displayPath(file.pattern)}` : "";
    out.log(`  created  ${posix.normalize(`${routesLabel}/${file.file}`)}${route}`);
  }
  for (const file of result.skipped) {
    out.log(`  exists   ${posix.normalize(`${routesLabel}/${file.file}`)}  (left unchanged)`);
  }
}
