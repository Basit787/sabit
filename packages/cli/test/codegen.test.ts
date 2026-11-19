import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type RouteSources, resolveRoutes } from "@sabit/router";
import { describe, expect, it } from "vitest";
import {
  generateRouteTree,
  planScaffold,
  run,
  writeRouteTree,
  writeScaffold,
} from "../src/index.ts";
import { captureOutput, tempProject } from "./helpers.ts";

async function projectWithUsers() {
  const root = await tempProject();
  const routesDir = join(root, "src/routes");
  await writeScaffold(routesDir, planScaffold("users"));
  await writeFile(join(routesDir, "api.ts"), "export const GET = () => 'hi';\n");
  await writeFile(
    join(routesDir, "middleware.ts"),
    "export default (_c: unknown, next: () => unknown) => next();\n",
  );
  return { root, routesDir, outFile: join(root, "src/sabit.route.ts") };
}

describe("route tree", () => {
  it("statically imports every route and middleware file", async () => {
    const { routesDir } = await projectWithUsers();
    const source = await generateRouteTree({ routesDir });
    expect(source).toContain('import * as middleware0 from "./routes/middleware.ts";');
    expect(source).toContain('import * as route0 from "./routes/api.ts";');
    expect(source).toContain('import * as route2 from "./routes/users/[id]/api.ts";');
    expect(source).toContain('{ file: "users/[id]/api.ts", load: () => route2 }, // /users/[id]');
    expect(source).toContain(
      'export type RoutePattern =\n  | "/"\n  | "/users"\n  | "/users/[id]";',
    );
    expect(source).toContain('import * as schema0 from "./routes/users/schema.ts";');
    expect(source).toContain('{ file: "users/schema.ts", load: () => schema0 },');
    expect(source).not.toContain("appMiddleware");
  });

  it("includes src/middleware.ts as the app middleware", async () => {
    const { root, routesDir } = await projectWithUsers();
    await writeFile(
      join(root, "src/middleware.ts"),
      "export default (_c: unknown, n: () => unknown) => n();\n",
    );
    const source = await generateRouteTree({ routesDir });
    expect(source).toContain('import * as appMiddleware from "./middleware.ts";');
    expect(source).toContain(
      'appMiddleware: { file: "../middleware.ts", load: () => appMiddleware },',
    );
  });

  it("uses .js specifiers for tsc-compiled projects", async () => {
    const { routesDir } = await projectWithUsers();
    const source = await generateRouteTree({ routesDir, importExtension: ".js" });
    expect(source).toContain('from "./routes/users/api.js";');
  });

  it("produces a module that resolveRoutes() serves", async () => {
    const { routesDir, outFile } = await projectWithUsers();
    await writeRouteTree({ routesDir, outFile });
    const { routeTree } = (await import(pathToFileURL(outFile).href)) as {
      routeTree: RouteSources;
    };
    const routes = await resolveRoutes(routeTree);
    expect(routes.map((r) => [r.pattern, r.methods.join(",")])).toEqual([
      ["/", "GET"],
      ["/users", "GET,POST"],
      ["/users/[id]", "GET,PUT,PATCH,DELETE"],
    ]);
  });

  it("only writes when the content changes", async () => {
    const { routesDir, outFile } = await projectWithUsers();
    expect(await writeRouteTree({ routesDir, outFile })).toBe(true);
    expect(await writeRouteTree({ routesDir, outFile })).toBe(false);
    await mkdir(join(routesDir, "health"));
    await writeFile(join(routesDir, "health/api.ts"), "export const GET = () => 'ok';\n");
    expect(await writeRouteTree({ routesDir, outFile })).toBe(true);
  });

  it("refuses to write a tree with conflicting routes", async () => {
    const { routesDir } = await projectWithUsers();
    await writeFile(join(routesDir, "users.ts"), "export const GET = () => [];\n");
    await expect(generateRouteTree({ routesDir })).rejects.toThrow(/conflicts with/);
  });

  it("is written by `sabit generate` and kept current by `sabit add`", async () => {
    const { root, outFile } = await projectWithUsers();
    const out = captureOutput();
    expect(await run(["generate"], { cwd: root, out })).toBe(0);
    expect(out.lines).toEqual(["  updated  src/sabit.route.ts"]);

    expect(await run(["add", "orders"], { cwd: root, out })).toBe(0);
    expect(out.lines.at(-1)).toBe("  updated  src/sabit.route.ts");
    expect(await readFile(outFile, "utf8")).toContain('"/orders/[id]"');
  });

  it("is created by `sabit init`", async () => {
    const root = await tempProject();
    await run(["init", "--framework", "hono"], { cwd: root, out: captureOutput() });
    expect(await readFile(join(root, "src/sabit.route.ts"), "utf8")).toContain(
      'import * as route1 from "./routes/users/api.ts";',
    );
  });
});
