import { existsSync } from "node:fs";
import { relative } from "node:path";
import { HTTP_METHODS } from "@sabit/router";
import { loadRoutes } from "@sabit/router/fs";
import type { Command } from "../command.ts";
import { resolveRoutesDir } from "../project.ts";
import { displayPath } from "../templates.ts";

export const routes: Command = {
  name: "routes",
  summary: "List every endpoint, in the order they're matched",
  usage: `sabit routes [--routes dir]

  Loads your route files (so it also reports conflicts and invalid exports)
  and prints a table of methods, paths and files.`,
  options: { routes: { type: "string" } },
  async run({ flags, cwd, out }) {
    const routesDir = resolveRoutesDir(cwd, flags.routes as string | undefined);
    if (!existsSync(routesDir)) {
      out.error(
        `No routes directory at ${relative(cwd, routesDir) || "."}. Create one with: sabit add users`,
      );
      return 1;
    }
    const loaded = await loadRoutes(routesDir);
    if (loaded.length === 0) {
      out.log("No routes yet. Create some with: sabit add users");
      return 0;
    }

    const rows = loaded.map((route) => [
      HTTP_METHODS.filter((m) => route.methods.includes(m)).join(", "),
      displayPath(route.pattern),
      route.file,
    ]);
    const header = ["METHODS", "PATH", "FILE"];
    const widths = header.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] as string).length)),
    );
    const line = (cells: string[]) =>
      cells
        .map((cell, i) => cell.padEnd(widths[i] as number))
        .join("   ")
        .trimEnd();

    out.log(line(header));
    for (const row of rows) out.log(line(row));
    out.log("");
    out.log(
      `${loaded.length} route${loaded.length === 1 ? "" : "s"} in ${relative(cwd, routesDir) || "."}`,
    );
    return 0;
  },
};
