import { describe, expect, it } from "vitest";
import {
  type CompiledRoute,
  compileRoutes,
  isModuleFileName,
  RouteDefinitionError,
} from "../src/index.ts";

const patterns = (routes: CompiledRoute[]) => routes.map((r) => r.pattern);

function problemsOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof RouteDefinitionError) return error.problems;
    throw error;
  }
  throw new Error("expected a RouteDefinitionError");
}

describe("isModuleFileName", () => {
  it.each([
    ["api.ts", true],
    ["[id].ts", true],
    ["[...path].ts", true],
    ["[[...slug]].mjs", true],
    ["middleware.js", true],
    ["users.service.ts", false],
    ["user.dto.ts", false],
    ["api.test.ts", false],
    ["types.d.ts", false],
    ["_helpers.ts", false],
    ["readme.md", false],
  ])("%s → %s", (name, expected) => {
    expect(isModuleFileName(name)).toBe(expected);
  });
});

describe("compileRoutes", () => {
  it("maps the documented example tree", () => {
    const routes = compileRoutes({
      routes: [
        "index.ts",
        "health.ts",
        "users/index.ts",
        "users/[id].ts",
        "users/[id]/posts.ts",
        "users/[id]/settings.ts",
        "products/index.ts",
        "products/[id].ts",
        "auth/login.ts",
        "auth/register.ts",
      ],
    });
    const byFile = Object.fromEntries(routes.map((r) => [r.file, r.pattern]));
    expect(byFile).toEqual({
      "index.ts": "/",
      "health.ts": "/health",
      "users/index.ts": "/users",
      "users/[id].ts": "/users/[id]",
      "users/[id]/posts.ts": "/users/[id]/posts",
      "users/[id]/settings.ts": "/users/[id]/settings",
      "products/index.ts": "/products",
      "products/[id].ts": "/products/[id]",
      "auth/login.ts": "/auth/login",
      "auth/register.ts": "/auth/register",
    });
  });

  it("accepts every supported extension", () => {
    const routes = compileRoutes({ routes: ["a.ts", "b.mts", "c.cts", "d.js", "e.mjs", "f.cjs"] });
    expect(patterns(routes)).toEqual(["/a", "/b", "/c", "/d", "/e", "/f"]);
  });

  it("lists param names in path order", () => {
    const [route] = compileRoutes({ routes: ["orgs/[org]/repos/[repo]/[...path].ts"] });
    expect(route?.paramNames).toEqual(["org", "repo", "path"]);
  });

  describe("middleware inheritance", () => {
    const routes = compileRoutes({
      routes: [
        "index.ts",
        "users/index.ts",
        "users/[id].ts",
        "users/[id]/posts.ts",
        "(protected)/dashboard.ts",
        "(public)/login.ts",
        "admin/users.ts",
      ],
      middleware: [
        "middleware.ts",
        "users/middleware.ts",
        "users/[id]/middleware.ts",
        "(protected)/middleware.ts",
        "admin/middleware.js",
      ],
    });
    const chain = (file: string) => routes.find((r) => r.file === file)?.middleware;

    it("applies root middleware to every route", () => {
      for (const route of routes) expect(route.middleware[0]).toBe("middleware.ts");
    });

    it("orders the chain from the routes root down to the file's directory", () => {
      expect(chain("users/[id]/posts.ts")).toEqual([
        "middleware.ts",
        "users/middleware.ts",
        "users/[id]/middleware.ts",
      ]);
    });

    it("does not apply a directory's middleware to its sibling file", () => {
      expect(chain("users/[id].ts")).toEqual(["middleware.ts", "users/middleware.ts"]);
    });

    it("scopes route group middleware to the group", () => {
      expect(chain("(protected)/dashboard.ts")).toEqual([
        "middleware.ts",
        "(protected)/middleware.ts",
      ]);
      expect(chain("(public)/login.ts")).toEqual(["middleware.ts"]);
    });
  });

  it("rejects two middleware files in one directory", () => {
    const problems = problemsOf(() =>
      compileRoutes({ routes: ["a.ts"], middleware: ["middleware.ts", "middleware.js"] }),
    );
    expect(problems[0]?.message).toMatch(/more than one middleware file/);
  });

  describe("conflicts", () => {
    it.each([
      [["users.ts", "users/index.ts"], "/users"],
      [["users/index.ts", "users/api.ts"], "/users"],
      [["users/[id].ts", "users/[id]/api.ts"], "/users/:"],
      [["(a)/login.ts", "(b)/login.ts"], "/login"],
      [["users/[id].ts", "users/[userId].ts"], "/users/:"],
      [["users/[id].ts", "users/[id]/index.ts"], "/users/:"],
      [["docs/index.ts", "docs/[[...slug]].ts"], "/docs"],
      [["docs/[...rest].ts", "docs/[[...slug]].ts"], "/docs/*"],
      [["index.ts", "[[...all]].ts"], "/"],
      [["About.ts", "about.ts"], "/about"],
      [["users.ts", "users.js"], "/users"],
    ])("%j conflict on %s", (files, shape) => {
      const problems = problemsOf(() => compileRoutes({ routes: files }));
      expect(problems).toHaveLength(1);
      expect(problems[0]?.message).toContain(`both handle ${shape}`);
    });

    it("explains optional catch-all conflicts", () => {
      const problems = problemsOf(() =>
        compileRoutes({ routes: ["docs/index.ts", "docs/[[...slug]].ts"] }),
      );
      expect(problems[0]?.hint).toMatch(/docs\/\[\[\.\.\.slug\]\]\.ts is an optional catch-all/);
    });

    it("allows routes that differ in specificity", () => {
      const routes = compileRoutes({
        routes: ["users/new.ts", "users/[id].ts", "users/[...rest].ts", "[[...all]].ts"],
      });
      expect(routes).toHaveLength(4);
    });

    it("reports all problems together", () => {
      const problems = problemsOf(() =>
        compileRoutes({ routes: ["a.ts", "a/index.ts", "b-[x].ts", "c/[...d]/e.ts"] }),
      );
      expect(problems.map((p) => p.file).sort()).toEqual([
        "a/index.ts",
        "b-[x].ts",
        "c/[...d]/e.ts",
      ]);
      expect(String(new RouteDefinitionError(problems).message)).toMatch(/Found 3 route problems/);
    });
  });

  describe("ordering", () => {
    it("sorts by specificity so registration-order routers pick the right route", () => {
      const routes = compileRoutes({
        routes: [
          "[...all].ts",
          "users/[...rest].ts",
          "users/[id].ts",
          "users/new.ts",
          "users/index.ts",
          "users/[id]/posts.ts",
          "index.ts",
        ],
      });
      expect(patterns(routes)).toEqual([
        "/",
        "/users",
        "/users/new",
        "/users/[id]",
        "/users/[id]/posts",
        "/users/[...rest]",
        "/[...all]",
      ]);
    });

    it("is independent of input order", () => {
      const files = ["b/[x].ts", "a.ts", "b/c.ts", "[y].ts", "b.ts"];
      const forward = patterns(compileRoutes({ routes: files }));
      const backward = patterns(compileRoutes({ routes: [...files].reverse() }));
      expect(forward).toEqual(backward);
    });
  });
});
