import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  await writeScaffold(routesDir, planScaffold("users", { auth: false }));
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
    await writeFile(join(routesDir, "users/schema.ts"), "export default {};\n");
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
      ["/docs", "GET"],
      ["/docs/openapi.json", "GET"],
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
    const tree = await readFile(join(root, "src/sabit.route.ts"), "utf8");
    expect(tree).toMatch(/import \* as route\d+ from "\.\/routes\/users\/api\.ts";/);
    expect(tree).not.toContain("routes/docs");
    expect(tree).toMatch(/apiDocs: \{ title: ".+ API" \},/);
  });

  it("refuses a top-level docs folder, the built-in API docs, but not a nested one", async () => {
    const { routesDir } = await projectWithUsers();
    await mkdir(join(routesDir, "users/docs"));
    await writeFile(join(routesDir, "users/docs/api.ts"), "export const GET = () => [];\n");
    await expect(generateRouteTree({ routesDir })).resolves.toContain('"/users/docs"');
    await mkdir(join(routesDir, "docs"));
    await writeFile(join(routesDir, "docs/api.ts"), "export const GET = () => [];\n");
    await expect(generateRouteTree({ routesDir })).rejects.toThrow(/built-in API docs/);
  });

  it("is kept in step by the access list: deleted routes are removed from it", async () => {
    const root = await tempProject();
    await run(["init", "--framework", "hono"], { cwd: root, out: captureOutput() });
    const out = captureOutput();
    expect(await run(["add", "orders"], { cwd: root, out })).toBe(0);
    const middleware = join(root, "src/middleware.ts");
    expect(await readFile(middleware, "utf8")).toContain('"/orders/[id]"');
    await rm(join(root, "src/routes/orders"), { recursive: true });
    expect(await run(["generate"], { cwd: root, out })).toBe(0);
    expect(await run(["add", "docs"], { cwd: root, out })).toBe(0);
    expect(out.errors.join("\n")).toContain("/docs is the built-in API docs");
    expect(await readFile(middleware, "utf8")).not.toContain("/orders");
  });
});
