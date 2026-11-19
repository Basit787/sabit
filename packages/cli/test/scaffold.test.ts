import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createContext, createMatcher, executeRoute, RouteDefinitionError } from "@sabit/router";
import { loadRoutes } from "@sabit/router/fs";
import { describe, expect, it } from "vitest";
import { planScaffold, UsageError, writeScaffold } from "../src/index.ts";
import { tempProject } from "./helpers.ts";

const summary = (folder: string, options?: Parameters<typeof planScaffold>[1]) =>
  planScaffold(folder, options).map((f) =>
    f.kind === "route" ? [f.file, f.pattern, f.methods.join(",")] : [f.file],
  );

describe("planScaffold", () => {
  it("creates route files with real handlers and a service for a resource", () => {
    expect(summary("users")).toEqual([
      ["users/api.ts", "/users", "GET,POST"],
      ["users/[id]/api.ts", "/users/[id]", "GET,PUT,PATCH,DELETE"],
      ["users/schema.ts"],
    ]);
  });

  it("puts the data and handlers in api.ts, with the folder's schema.ts", () => {
    const files = Object.fromEntries(planScaffold("blog-posts").map((f) => [f.file, f.content]));
    const api = files["blog-posts/api.ts"];
    const item = files["blog-posts/[id]/api.ts"];
    expect(api).not.toContain('schema.ts"');
    expect(api).toContain("export type BlogPost = { id: string; name: string };");
    expect(api).toContain("export const blogPosts: BlogPost[] = [");
    expect(api).toContain("export const GET = () => blogPosts;");
    expect(api).toContain("export const auth = { POST: true };");
    expect(item).toContain('import { type BlogPost, blogPosts } from "../api.ts";');
    expect(files["blog-posts/schema.ts"]).toContain("export default defineSchema({");
  });

  it("uses .js imports for projects compiled by tsc (NestJS)", () => {
    const files = planScaffold("users", { importExtension: ".js" });
    expect(files[1]?.content).toContain('from "../api.js"');
  });

  it("supports nested resources, groups, custom params and no item route", () => {
    expect(summary("users/[userId]/posts")[1]).toEqual([
      "users/[userId]/posts/[id]/api.ts",
      "/users/[userId]/posts/[id]",
      "GET,PUT,PATCH,DELETE",
    ]);
    expect(summary("(admin)/settings", { item: false })).toEqual([
      ["(admin)/settings/api.ts", "/settings", "GET,POST"],
      ["(admin)/settings/schema.ts"],
    ]);
    expect(summary("products", { param: "sku" })[1]).toEqual([
      "products/[sku]/api.ts",
      "/products/[sku]",
      "GET,PUT,PATCH,DELETE",
    ]);
  });

  it("creates only an item route for a dynamic folder", () => {
    expect(summary("orders/[orderId]")).toEqual([
      ["orders/[orderId]/api.ts", "/orders/[orderId]", "GET,PATCH,DELETE"],
    ]);
  });

  it("creates a GET route for catch-all folders", () => {
    expect(summary("files/[...path]")).toEqual([
      ["files/[...path]/api.ts", "/files/[...path]", "GET"],
    ]);
  });

  it("normalizes slashes", () => {
    expect(summary("/users/")[0]?.[0]).toBe("users/api.ts");
    expect(summary("admin\\users")[0]?.[0]).toBe("admin/users/api.ts");
  });

  it.each([
    ["", UsageError, /give a resource name/],
    ["../etc", UsageError, /can't contain '..'/],
    ["_lib", UsageError, /private/],
    ["(admin)", UsageError, /route group/],
    ["user-[id]", RouteDefinitionError, /mixes static text/],
    ["users", RouteDefinitionError, /not a valid param name/, { param: "1x" }],
  ] as const)("rejects %j", (folder, type, message, options: { param?: string } = {}) => {
    expect(() => planScaffold(folder, options)).toThrow(type);
    expect(() => planScaffold(folder, options)).toThrow(message);
  });
});

describe("writeScaffold", () => {
  it("writes a working CRUD resource", async () => {
    const dir = join(await tempProject(), "src/routes");
    await writeScaffold(dir, planScaffold("users", { auth: false }));

    const routes = await loadRoutes(dir);
    expect(routes.map((r) => r.file)).toEqual(["users/api.ts", "users/[id]/api.ts"]);
    const match = createMatcher(routes);
    const call = async (
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      path: string,
      body?: unknown,
      token: string | null = "test-token",
    ) => {
      const found = match(path);
      if (!found) throw new Error(`no route for ${path}`);
      const ctx = createContext(found.route, {
        method,
        url: path,
        params: found.params,
        headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
        body,
        raw: { framework: "test" },
      });
      const outcome = await executeRoute(found.route, method, ctx);
      return [outcome.status, outcome.body === null ? null : JSON.parse(String(outcome.body))];
    };

    const samples = [
      { id: "1", name: "Sample user 1" },
      { id: "2", name: "Sample user 2" },
    ];
    expect(await call("GET", "/users")).toEqual([200, samples]);
    expect(await call("GET", "/users/1")).toEqual([200, samples[0]]);

    const [status, created] = await call("POST", "/users", { name: "Ada", id: "ignored" });
    expect(status).toBe(201);
    const id = created.id as string;
    expect(created).toEqual({ name: "Ada", id });
    expect(id).not.toBe("ignored");

    expect(await call("PATCH", `/users/${id}`, { name: "Ada L." })).toEqual([
      200,
      { name: "Ada L.", id },
    ]);
    expect(await call("PUT", `/users/${id}`, { name: "Grace" })).toEqual([
      200,
      { name: "Grace", id },
    ]);
    expect(await call("DELETE", `/users/${id}`)).toEqual([204, null]);
    expect(await call("GET", `/users/${id}`)).toEqual([
      404,
      { error: { status: 404, message: "User not found" } },
    ]);
  });

  it("never overwrites existing files", async () => {
    const dir = join(await tempProject(), "src/routes");
    await writeScaffold(dir, planScaffold("users"));
    await writeFile(join(dir, "users/api.ts"), "export const GET = () => 'mine';\n");

    const result = await writeScaffold(dir, planScaffold("users"));
    expect(result.created).toEqual([]);
    expect(result.skipped.map((f) => f.file)).toEqual([
      "users/api.ts",
      "users/[id]/api.ts",
      "users/schema.ts",
    ]);
    expect(await readFile(join(dir, "users/api.ts"), "utf8")).toContain("mine");
  });

  it("refuses to create conflicting routes and writes nothing", async () => {
    const dir = join(await tempProject(), "src/routes");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "users.ts"), "export const GET = () => [];\n");
    await expect(writeScaffold(dir, planScaffold("users"))).rejects.toThrow(/conflicts with/);
    const after = await loadRoutes(dir);
    expect(after.map((r) => r.file)).toEqual(["users.ts"]);
  });
});

describe("project style", () => {
  it("writes single-quoted code that still loads", async () => {
    const dir = join(await tempProject(), "src/routes");
    const files = planScaffold("users", { quote: "single", auth: false });
    expect(files.every((f) => !f.content.includes('"'))).toBe(true);
    await writeScaffold(dir, files);
    const routes = await loadRoutes(dir);
    expect(routes.map((r) => [r.pattern, r.methods.join(",")])).toEqual([
      ["/users", "GET,POST"],
      ["/users/[id]", "GET,PUT,PATCH,DELETE"],
    ]);
  });

  it("reads the quote style from Biome or Prettier", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { detectQuoteStyle } = await import("../src/index.ts");
    const biome = await tempProject();
    await writeFile(
      join(biome, "biome.json"),
      '{ "javascript": { "formatter": { "quoteStyle": "single" } } }',
    );
    const prettier = await tempProject();
    await writeFile(join(prettier, ".prettierrc"), '{ "singleQuote": true }');
    expect(detectQuoteStyle(biome)).toBe("single");
    expect(detectQuoteStyle(prettier)).toBe("single");
    expect(detectQuoteStyle(await tempProject())).toBe("double");
  });
});
