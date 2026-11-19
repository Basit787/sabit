import { describe, expect, it } from "vitest";
import { z } from "zod";
import { apiDocsPage, type ModuleSource, openApiDocument, resolveRoutes } from "../src/index.ts";

const source = (file: string, mod: unknown): ModuleSource => ({ file, load: () => mod });
const ok = () => null;

async function documentFor(sources: Parameters<typeof resolveRoutes>[0], access = {}) {
  return openApiDocument(await resolveRoutes(sources), { title: "Shop", access }) as {
    info: { title: string };
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
}

describe("openApiDocument", () => {
  it("lists every route and method with path params, leaving out HEAD", async () => {
    const doc = await documentFor({
      routes: [
        source("products/api.ts", { GET: ok, HEAD: ok, POST: ok }),
        source("products/[id]/api.ts", { GET: ok, DELETE: ok }),
        source("files/[...path]/api.ts", { GET: ok }),
      ],
    });
    expect(doc.info.title).toBe("Shop");
    expect(Object.keys(doc.paths["/products"] ?? {})).toEqual(["get", "post"]);
    const item = doc.paths["/products/{id}"]?.get;
    expect(item?.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ]);
    expect(item?.tags).toEqual(["products"]);
    expect(doc.paths["/files/{path}"]).toBeDefined();
  });

  it("documents schema.ts bodies, partial for PATCH", async () => {
    const schema = z.object({ name: z.string(), at: z.date().optional() });
    const doc = await documentFor({
      routes: [source("products/api.ts", { POST: ok, PATCH: ok })],
      schemas: [
        source("products/schema.ts", {
          default: { "~standard": schema["~standard"], partial: () => schema.partial() },
        }),
      ],
    });
    const post = doc.paths["/products"]?.post as {
      requestBody: { content: Record<string, { schema: unknown }> };
    };
    expect(post.requestBody.content["application/json"]?.schema).toMatchObject({
      type: "object",
      required: ["name"],
      properties: { at: { type: "string", format: "date-time" } },
    });
    const patch = doc.paths["/products"]?.patch as {
      requestBody: { content: Record<string, { schema: { required?: unknown } }> };
    };
    expect(patch.requestBody.content["application/json"]?.schema.required).toBeUndefined();
  });

  it("marks routes the access list or an auth export protects, and hides docs = false", async () => {
    const doc = await documentFor(
      {
        routes: [
          source("users/api.ts", { GET: ok, POST: ok }),
          source("orders/api.ts", { GET: ok, auth: true }),
          source("docs/api.ts", { GET: ok, docs: false }),
          source("tags/api.ts", { GET: ok, docs: { GET: "List tags", tags: ["catalog"] } }),
        ],
      },
      { "/users": { POST: "admin" } },
    );
    expect(doc.paths["/users"]?.get?.security).toBeUndefined();
    expect(doc.paths["/users"]?.post).toMatchObject({
      security: [{ bearerAuth: [] }],
      responses: { "401": {}, "403": {} },
    });
    expect(doc.paths["/orders"]?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths["/docs"]).toBeUndefined();
    expect(doc.paths["/tags"]?.get).toMatchObject({ summary: "List tags", tags: ["catalog"] });
  });
});

describe("apiDocsPage", () => {
  it("serves Swagger UI for the spec with a CSP that allows only its own script", async () => {
    const page = await apiDocsPage("/docs/openapi.json");
    const html = await page.text();
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(html).toContain('url: "/docs/openapi.json"');
    expect(page.headers.get("content-security-policy")).toMatch(
      /script-src https:\/\/cdn\.jsdelivr\.net 'sha256-[A-Za-z0-9+/=]+'/,
    );
  });
});

describe("built-in API docs (apiDocs)", () => {
  it("adds GET /docs and /docs/openapi.json, reading the app's access list, outside the document", async () => {
    const routes = await resolveRoutes({
      routes: [source("users/api.ts", { GET: ok, POST: ok })],
      appMiddleware: source("../middleware.ts", {
        default: (_ctx: unknown, next: () => unknown) => next(),
        access: { "/users": { POST: true } },
      }),
      apiDocs: { title: "Shop" },
    });
    expect(routes.map((r) => r.pattern)).toEqual(["/docs", "/docs/openapi.json", "/users"]);
    const spec = routes.find((r) => r.pattern === "/docs/openapi.json");
    const doc = (await spec?.handlers.GET?.({} as never)) as {
      info: { title: string };
      paths: Record<string, Record<string, { security?: unknown }>>;
    };
    expect(doc.info.title).toBe("Shop");
    expect(Object.keys(doc.paths)).toEqual(["/users"]);
    expect(doc.paths["/users"]?.post?.security).toEqual([{ bearerAuth: [] }]);
  });

  it("reserves the top-level docs folder, not nested ones", async () => {
    await expect(
      resolveRoutes({ routes: [source("docs/api.ts", { GET: ok })], apiDocs: {} }),
    ).rejects.toThrow(/\/docs is the built-in API docs/);
    const routes = await resolveRoutes({
      routes: [source("products/docs/api.ts", { GET: ok })],
      apiDocs: {},
    });
    expect(routes.map((r) => r.pattern)).toContain("/products/docs");
  });

  it("is off in production unless API_DOCS=true", async () => {
    const before = { ...process.env };
    try {
      process.env.NODE_ENV = "production";
      const sources = { routes: [source("api.ts", { GET: ok })], apiDocs: {} };
      expect((await resolveRoutes(sources)).map((r) => r.pattern)).toEqual(["/"]);
      process.env.API_DOCS = "true";
      expect((await resolveRoutes(sources)).map((r) => r.pattern)).toContain("/docs");
    } finally {
      process.env = before;
    }
  });
});
