import { existsSync } from "node:fs";
import { relative } from "node:path";
import { refreshRouteTree } from "../codegen.ts";
import type { Command } from "../command.ts";
import { resolveRoutesDir } from "../project.ts";
import { add } from "./add.ts";

export const generate: Command = {
  name: "generate",
  aliases: ["g"],
  summary: "Write src/sabit.route.ts, the generated route tree (or: generate route <resource>)",
  usage: `sabit generate [--routes dir]
sabit generate route <resource...>      same as \`sabit add\`

  Writes <routes dir>/../sabit.route.ts: static imports of every route and
  middleware file, plus a RoutePattern type. Use it in your server with
      resolveRoutes(routeTree)
  \`sabit dev\` and \`sabit add\` keep it up to date once it exists; run this in
  CI or before building to be sure it's current.`,
  options: { ...add.options },
  async run(ctx) {
    const [kind, ...rest] = ctx.args;
    if (kind === "route") return add.run({ ...ctx, args: rest });
    if (kind !== undefined) {
      ctx.out.error(
        `Unknown generator "${kind}". Run \`sabit generate\` or \`sabit generate route <name>\`.`,
      );
      return 1;
    }
    const routesDir = resolveRoutesDir(ctx.cwd, ctx.flags.routes as string | undefined);
    if (!existsSync(routesDir)) {
      ctx.out.error(`No routes directory at ${relative(ctx.cwd, routesDir) || "."}.`);
      return 1;
    }
    return (await refreshRouteTree(ctx.cwd, routesDir, ctx.out, { create: true })) ? 0 : 1;
  },
};
