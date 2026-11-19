import { describe, expect, it } from "vitest";
import {
  compileRoutes,
  createContext,
  createMatcher,
  formatPaths,
  normalizeParams,
  type PathDialect,
  parseRoutePath,
  queryFromSearchParams,
} from "../src/index.ts";

describe("createMatcher", () => {
  const match = createMatcher(
    compileRoutes({
      routes: [
        "index.ts",
        "users/index.ts",
        "users/new.ts",
        "users/[id].ts",
        "users/[id]/posts.ts",
        "files/[...path].ts",
        "docs/[[...slug]].ts",
        "(marketing)/pricing.ts",
      ],
    }),
  );
  const resolve = (path: string) => {
    const m = match(path);
    return m && { pattern: m.route.pattern, params: m.params };
  };

  it.each([
    ["/", "/", {}],
    ["/users", "/users", {}],
    ["/users/", "/users", {}],
    ["/users/new", "/users/new", {}],
    ["/users/42", "/users/[id]", { id: "42" }],
    ["/users/42/posts", "/users/[id]/posts", { id: "42" }],
    ["/users/a%20b", "/users/[id]", { id: "a b" }],
    ["/files/a/b/c.txt", "/files/[...path]", { path: ["a", "b", "c.txt"] }],
    ["/docs", "/docs/[[...slug]]", { slug: [] }],
    ["/docs/guide/intro", "/docs/[[...slug]]", { slug: ["guide", "intro"] }],
    ["/pricing", "/pricing", {}],
  ])("%s -> %s", (path, pattern, params) => {
    expect(resolve(path)).toEqual({ pattern, params });
  });

  it.each(["/files", "/users/42/comments", "/nope", "/users/%E0%A4%A"])(
    "%s -> no match",
    (path) => {
      expect(match(path)).toBeNull();
    },
  );
});

describe("formatPaths", () => {
  const route = (path: string) => parseRoutePath(path);
  const express: PathDialect = { param: (n) => `:${n}`, catchAll: (n) => `*${n}` };

  it.each([
    ["index", ["/"]],
    ["users/[id]/posts", ["/users/:id/posts"]],
    ["files/[...path]", ["/files/*path"]],
    ["docs/[[...slug]]", ["/docs", "/docs/*slug"]],
    ["[[...all]]", ["/", "/*all"]],
  ])("%s -> %j", (path, expected) => {
    expect(formatPaths(route(path), express)).toEqual(expected);
  });
});

describe("params and query normalization", () => {
  const { segments } = parseRoutePath("orgs/[org]/files/[...path]");

  it("splits catch-all strings and reads custom catch-all keys", () => {
    expect(normalizeParams(segments, { org: "acme", "*": "a/b" }, () => "*")).toEqual({
      org: "acme",
      path: ["a", "b"],
    });
  });

  it("accepts catch-alls already split into arrays", () => {
    expect(normalizeParams(segments, { org: "acme", path: ["a", "b"] })).toEqual({
      org: "acme",
      path: ["a", "b"],
    });
  });

  it("returns an empty array for a missing optional catch-all", () => {
    expect(normalizeParams(parseRoutePath("docs/[[...slug]]").segments, {})).toEqual({ slug: [] });
  });

  it("turns repeated query keys into arrays", () => {
    expect(queryFromSearchParams(new URLSearchParams("a=1&b=2&b=3&c="))).toEqual({
      a: "1",
      b: ["2", "3"],
      c: "",
    });
  });

  it("builds the request path and query from a relative or absolute URL", () => {
    const route = parseRoutePath("search");
    const init = {
      method: "GET" as const,
      params: {},
      headers: new Headers(),
      body: undefined,
      raw: { framework: "test" },
    };
    const relative = createContext(route, { ...init, url: "/search?q=x" });
    expect([relative.path, relative.query, relative.route]).toEqual([
      "/search",
      { q: "x" },
      "/search",
    ]);
    const absolute = createContext(route, { ...init, url: "https://example.com/search?q=y" });
    expect(absolute.query).toEqual({ q: "y" });
  });
});
