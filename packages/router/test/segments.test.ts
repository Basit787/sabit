import { describe, expect, it } from "vitest";
import { parseRoutePath, RouteDefinitionError, tryParseRoutePath } from "../src/index.ts";

describe("parseRoutePath", () => {
  it.each([
    ["index", "/", []],
    ["health", "/health", []],
    ["users/index", "/users", []],
    ["users/[id]", "/users/[id]", []],
    ["users/[id]/posts", "/users/[id]/posts", []],
    ["users/[id]/index", "/users/[id]", []],
    ["api", "/", []],
    ["users/api", "/users", []],
    ["users/[id]/api", "/users/[id]", []],
    ["files/[...path]/api", "/files/[...path]", []],
    ["api/users", "/api/users", []],
    ["files/[...path]", "/files/[...path]", []],
    ["files/[...path]/index", "/files/[...path]", []],
    ["docs/[[...slug]]", "/docs/[[...slug]]", []],
    ["(public)/login", "/login", ["public"]],
    ["(a)/(b)/index", "/", ["a", "b"]],
    ["api/(v1)/users", "/api/users", ["v1"]],
    ["users.json", "/users.json", []],
    ["~me", "/~me", []],
  ])("%s -> %s", (input, pattern, groups) => {
    const parsed = parseRoutePath(input);
    expect(parsed.pattern).toBe(pattern);
    expect(parsed.groups).toEqual(groups);
  });

  it("produces typed segments", () => {
    expect(parseRoutePath("a/[b]/[...c]").segments).toEqual([
      { kind: "static", value: "a" },
      { kind: "dynamic", name: "b" },
      { kind: "catchAll", name: "c" },
    ]);
    expect(parseRoutePath("[[...rest]]").segments).toEqual([
      { kind: "optionalCatchAll", name: "rest" },
    ]);
  });

  it("only treats index as special in the last position", () => {
    expect(parseRoutePath("index/users").pattern).toBe("/index/users");
  });

  it.each([
    ["user-[id]", /mixes static text and a dynamic segment/],
    ["[id]x", /mixes static text/],
    ["[]", /not a valid param name/],
    ["[1id]", /not a valid param name/],
    ["[user-id]", /not a valid param name/],
    ["[..id]", /not a valid dynamic segment/],
    ["[[id]]", /not a valid dynamic segment/],
    ["[...a]/b", /must be the last segment/],
    ["[[...a]]/b", /must be the last segment/],
    ["[id]/[id]", /appears more than once/],
    ["users/:id", /not allowed in a static path segment/],
    ["a*b", /not allowed/],
    ["what?", /not allowed/],
    ["(group)", /route groups must be directories/],
    ["()/x", /not allowed/],
    ["a//b", /empty segment/],
  ])("rejects %s", (input, message) => {
    expect(() => parseRoutePath(input)).toThrow(message);
  });

  it("reports every problem in a path at once", () => {
    const result = tryParseRoutePath("bad:/[1]/[...x]/y", "bad.ts");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(3);
    expect(result.problems.every((p) => p.file === "bad.ts")).toBe(true);
  });

  it("throws RouteDefinitionError with a hint", () => {
    try {
      parseRoutePath("user-[id]", "user-[id].ts");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RouteDefinitionError);
      const problem = (error as RouteDefinitionError).problems[0];
      expect(problem?.file).toBe("user-[id].ts");
      expect(problem?.hint).toMatch(/whole file or folder name/);
    }
  });
});
