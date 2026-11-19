import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadRoutes, scanRoutes } from "../src/fs/index.ts";
import {
  createMatcher,
  executeRoute,
  type RouteContext,
  RouteDefinitionError,
} from "../src/index.ts";
import { makeContext, readBody } from "./helpers.ts";

const routesDir = new URL("./fixtures/app/routes", import.meta.url);

describe("scanRoutes", () => {
  it("finds routes and middleware, skipping private, test and declaration files", async () => {
    const { routes, middleware } = await scanRoutes(routesDir);
    expect(routes).toEqual([
      "(protected)/dashboard.ts",
      "(public)/signup.ts",
      "admin/users.ts",
      "auth/login.ts",
      "auth/register.ts",
      "docs/[[...slug]].ts",
      "files/[...path].ts",
      "health.ts",
      "index.ts",
      "products/[id].ts",
      "products/index.ts",
      "users/[id].ts",
      "users/[id]/posts.ts",
      "users/[id]/settings.ts",
      "users/index.ts",
      "users/new.ts",
    ]);
    expect(middleware).toEqual([
      "(protected)/middleware.ts",
      "middleware.ts",
      "users/middleware.ts",
    ]);
  });

  it("explains a missing routes directory", async () => {
    await expect(scanRoutes("/definitely/not/here")).rejects.toThrow(
      "Routes directory not found: /definitely/not/here",
    );
  });
});

describe("loadRoutes", () => {
  it("loads the fixture app and maps every file to its URL pattern", async () => {
    const routes = await loadRoutes(routesDir);
    expect(routes.map((r) => [r.pattern, r.methods.join(",")])).toEqual([
      ["/", "GET"],
      ["/admin/users", "GET"],
      ["/auth/login", "POST"],
      ["/auth/register", "POST"],
      ["/dashboard", "GET"],
      ["/docs/[[...slug]]", "GET"],
      ["/files/[...path]", "GET"],
      ["/health", "GET"],
      ["/products", "GET"],
      ["/products/[id]", "GET"],
      ["/signup", "POST"],
      ["/users", "GET,POST"],
      ["/users/new", "GET"],
      ["/users/[id]", "GET,DELETE"],
      ["/users/[id]/posts", "GET"],
      ["/users/[id]/settings", "PATCH"],
    ]);
  });

  it("runs inherited, group and route-level middleware end to end", async () => {
    const routes = await loadRoutes(routesDir);
    const match = createMatcher(routes);
    const call = async (path: string, init: Partial<Parameters<typeof makeContext>[1]> = {}) => {
      const found = match(path);
      if (!found) throw new Error(`no route for ${path}`);
      const ctx: RouteContext = makeContext(found.route.pattern, {
        url: path,
        params: found.params,
        ...init,
      });
      const outcome = await executeRoute(found.route, ctx.method, ctx);
      return { status: outcome.status, body: JSON.parse((await readBody(outcome.body)) ?? "null") };
    };

    expect(await call("/users/7")).toEqual({
      status: 200,
      body: { userId: "7", trace: ["root", "users"] },
    });
    expect(await call("/admin/users")).toEqual({
      status: 200,
      body: { trace: ["root", "admin/users route"] },
    });
    expect((await call("/dashboard")).status).toBe(401);
    expect(
      await call("/dashboard", { headers: new Headers({ authorization: "Bearer secret" }) }),
    ).toEqual({ status: 200, body: { route: "dashboard", trace: ["root", "protected"] } });
    expect(await call("/docs/a/b")).toEqual({ status: 200, body: { slug: ["a", "b"] } });
  });

  describe("with a temporary routes directory", () => {
    const dirs: string[] = [];
    const makeRoutes = async (files: Record<string, string>) => {
      const dir = await mkdtemp(join(tmpdir(), "sabit-routes-"));
      dirs.push(dir);
      for (const [file, content] of Object.entries(files)) {
        await mkdir(join(dir, file, ".."), { recursive: true });
        await writeFile(join(dir, file), content);
      }
      return dir;
    };
    afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

    it("loads plain JavaScript route files", async () => {
      const dir = await makeRoutes({ "ping.mjs": "export const GET = () => 'pong';" });
      const [route] = await loadRoutes(dir);
      expect(route?.pattern).toBe("/ping");
    });

    it("reports conflicts and broken files together", async () => {
      const dir = await makeRoutes({
        "a.mjs": "export const GET = () => 1;",
        "a/index.mjs": "export const GET = () => 1;",
        "b.mjs": "export const GET = () => {;",
      });
      const error = await loadRoutes(dir).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RouteDefinitionError);
      expect((error as RouteDefinitionError).problems).toEqual([
        expect.objectContaining({
          file: "a/index.mjs",
          message: expect.stringMatching(/conflicts/),
        }),
      ]);
    });

    it("reports syntax errors with the file name", async () => {
      const dir = await makeRoutes({ "b.mjs": "export const GET = () => {;" });
      const error = (await loadRoutes(dir).catch((e: unknown) => e)) as RouteDefinitionError;
      expect(error.problems[0]?.file).toBe("b.mjs");
      expect(error.problems[0]?.message).toMatch(/^failed to load:/);
      expect(error.cause).toBeInstanceOf(Error);
    });
  });
});
