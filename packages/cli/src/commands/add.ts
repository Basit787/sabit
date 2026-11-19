import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { refreshRouteTree } from "../codegen.ts";
import type { Command, Output } from "../command.ts";
import { resolveRoutesDir } from "../project.ts";
import { listRoutesInMiddleware } from "../route-watcher.ts";
import {
  addAccessRules,
  DOCS_RESERVED,
  detectProjectStyle,
  hasAccessList,
  hasAppMiddleware,
  planScaffold,
  type ScaffoldFile,
  type ScaffoldResult,
  servesDocs,
  writeRouteTests,
  writeScaffold,
} from "../scaffold.ts";
import { displayPath } from "../templates.ts";

/*
 * `sabit add <resource>`: writes the routes, schema and tests. With an access list in src/middleware.ts,
 * the new routes' rules go there; otherwise into an `auth` export in each route.
 */
export const add: Command = {
  name: "add",
  summary: "Create REST endpoints for a resource (users → /users and /users/:id)",
  usage: `sabit add <resource...> [--param id] [--no-item] [--routes dir]

  Creates, for e.g. \`sabit add users\`:
    routes/users/api.ts        GET (list), POST (create) + sample data
    routes/users/[id]/api.ts   GET, PUT, PATCH, DELETE
    routes/users/schema.ts     what a user looks like; POST/PUT/PATCH bodies are checked
    test/routes/users/...      a Vitest test for each route (npm test)

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
      const central = hasAccessList(routesDir);
      const style = detectProjectStyle(cwd);
      const files = planScaffold(resource, {
        param: (flags.param as string | undefined) ?? "id",
        item: flags["no-item"] !== true,
        ...style,
        auth: central || hasAppMiddleware(routesDir),
        authIn: central ? "middleware" : "route",
      });
      if (servesDocs(files)) {
        out.error(`  skipped  ${resource}: ${DOCS_RESERVED}`);
        continue;
      }
      const result = await writeScaffold(routesDir, files);
      report(result, relative(cwd, routesDir) || ".", out);
      if (central && (await addAccessRules(routesDir, result.created, style.quote))) {
        out.log(`  updated  ${relative(cwd, join(dirname(routesDir), "middleware.ts"))}`);
      }
      await addRouteTests(cwd, routesDir, result.created, out);
    }
    await refreshRouteTree(cwd, routesDir, out, { quiet: true });
    await listRoutesInMiddleware(cwd, routesDir, out);
    return 0;
  },
};

// Writes and lists the tests of newly created routes. Shared with `dev` and `init`.
export async function addRouteTests(
  projectRoot: string,
  routesDir: string,
  created: readonly ScaffoldFile[],
  out: Output,
): Promise<void> {
  const written = await writeRouteTests(projectRoot, routesDir, created);
  for (const file of written) out.log(`  created  ${file}`);
  const pkg = join(projectRoot, "package.json");
  if (written.length > 0 && existsSync(pkg) && !readFileSync(pkg, "utf8").includes('"vitest"')) {
    out.log("  note     the tests use Vitest: add it with `npm i -D vitest`");
  }
}

// Prints what a scaffold created or skipped. Shared with `dev`.
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
