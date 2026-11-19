import type { ResolvedRoute } from "@sabit/router";
import { loadRoutes } from "@sabit/router/fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Directory of the fixture app every adapter is tested against.
export const conformanceRoutesDir = new URL("../routes", import.meta.url);

// A started test server: `baseUrl` with any mount prefix and no trailing slash, and `close()`.
export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export type StartServer = (routes: ResolvedRoute[]) => Promise<RunningServer>;

/*
 * The behavior every adapter must pass unchanged: same routing on every framework. Statuses and bodies
 * are exact, except where frameworks own the answer (404 unknown path, 400 bad JSON, 413 oversized).
 */
export function runConformanceSuite(name: string, start: StartServer): void {
  describe(`${name} adapter conformance`, () => {
    let server: RunningServer;

    beforeAll(async () => {
      server = await start(await loadRoutes(conformanceRoutesDir));
    });
    afterAll(() => server?.close());

    const request = (path: string, init?: RequestInit) => fetch(`${server.baseUrl}${path}`, init);
    const json = async (path: string, init?: RequestInit) => {
      const response = await request(path, init);
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
    const send = (method: string, body: string, contentType: string): RequestInit => ({
      method,
      body,
      headers: { "content-type": contentType },
    });

    describe("route mapping", () => {
      it("serves the root index route", async () => {
        expect(await json("/")).toMatchObject({ status: 200, body: { hello: "world" } });
      });

      it("serves static file routes", async () => {
        const response = await request("/health");
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(await response.text()).toBe("ok");
      });

      it("prefers static over dynamic segments", async () => {
        expect((await json("/users/new")).body).toEqual({ form: true });
      });

      it("passes dynamic params, percent-decoded", async () => {
        expect((await json("/users/42")).body).toMatchObject({ id: "42" });
        expect((await json("/users/a%20b")).body).toMatchObject({ id: "a b" });
      });

      it("resolves nested routes under dynamic directories", async () => {
        expect((await json("/users/42/posts")).body).toEqual({ userId: "42", posts: [] });
      });

      it("passes catch-all params as arrays and requires at least one segment", async () => {
        expect((await json("/files/a/b/c.txt")).body).toEqual({ path: ["a", "b", "c.txt"] });
        expect((await request("/files")).status).toBe(404);
      });

      it("matches optional catch-alls with and without segments", async () => {
        expect((await json("/docs")).body).toEqual({ slug: [] });
        expect((await json("/docs/guide/intro")).body).toEqual({ slug: ["guide", "intro"] });
      });

      it("keeps route groups out of the URL", async () => {
        const auth = { headers: { authorization: "Bearer admin" } };
        expect((await request("/admin-panel", auth)).status).toBe(200);
        expect((await request("/(admin)/admin-panel", auth)).status).toBe(404);
      });

      it("returns 404 for unknown paths", async () => {
        expect((await request("/does-not-exist")).status).toBe(404);
      });
    });

    describe("request context", () => {
      it("normalizes the query string, with repeated keys as arrays", async () => {
        expect((await json("/users?tag=a&tag=b&page=2")).body.query).toEqual({
          tag: ["a", "b"],
          page: "2",
        });
      });

      it("parses JSON bodies", async () => {
        const { body } = await json("/echo", send("POST", '{"a":[1,2]}', "application/json"));
        expect(body).toEqual({ body: { a: [1, 2] }, contentType: "application/json" });
      });

      it("parses URL-encoded bodies, with repeated keys as arrays", async () => {
        const { body } = await json(
          "/echo",
          send("PUT", "name=Ada&tag=x&tag=y", "application/x-www-form-urlencoded"),
        );
        expect(body.body).toEqual({ name: "Ada", tag: ["x", "y"] });
      });

      it("parses text bodies", async () => {
        const { body } = await json("/echo", send("POST", "plain words", "text/plain"));
        expect(body.body).toBe("plain words");
      });

      it("has no body when none was sent", async () => {
        expect((await json("/echo", { method: "POST" })).body.body).toBeNull();
      });

      it("rejects malformed JSON with 400", async () => {
        expect((await request("/echo", send("POST", "{oops", "application/json"))).status).toBe(
          400,
        );
      });

      it("exposes request headers", async () => {
        const { body } = await json("/users/1", { headers: { "x-request-id": "req-123" } });
        expect(body.requestId).toBe("req-123");
      });
    });

    describe("responses", () => {
      it("sends reply() status, headers and JSON body", async () => {
        const { status, headers, body } = await json(
          "/users",
          send("POST", '{"name":"Ada"}', "application/json"),
        );
        expect(status).toBe(201);
        expect(headers.get("location")).toBe("/users/1");
        expect(headers.get("content-type")).toMatch(/^application\/json/);
        expect(body).toEqual({ created: { name: "Ada" } });
      });

      it("sends 204 with no body for undefined", async () => {
        const response = await request("/users/1", { method: "DELETE" });
        expect(response.status).toBe(204);
        expect(await response.text()).toBe("");
        expect((await request("/responses/empty")).status).toBe(204);
      });

      it("passes web Responses through", async () => {
        const response = await request("/responses/web");
        expect(response.status).toBe(202);
        expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(response.headers.get("x-custom")).toBe("web");
        expect(await response.text()).toBe("<h1>hi</h1>");
      });

      it("streams ReadableStream bodies", async () => {
        expect(await (await request("/responses/stream")).text()).toBe("chunk-1,chunk-2");
      });

      it("sends binary bodies", async () => {
        const response = await request("/responses/bytes");
        expect(response.headers.get("content-type")).toBe("application/octet-stream");
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3, 250]);
      });

      it("sends multiple Set-Cookie headers", async () => {
        const response = await request("/responses/cookies");
        expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
      });
    });

    describe("errors", () => {
      it("renders HttpError as JSON with its status and headers", async () => {
        const { status, headers, body } = await json("/errors/http");
        expect(status).toBe(418);
        expect(headers.get("x-error")).toBe("yes");
        expect(body).toEqual({
          error: { status: 418, message: "I'm a teapot", details: { brew: "tea" } },
        });
      });

      it("answers other errors with a plain 500 that never includes their message", async () => {
        const { status, body } = await json("/errors/crash");
        expect(status).toBe(500);
        expect(body).toEqual({ error: { status: 500, message: "Internal Server Error" } });
      });

      it("refuses oversized bodies with 413", async () => {
        const big = JSON.stringify({ data: "x".repeat(200 * 1024) });
        expect((await request("/echo", send("POST", big, "application/json"))).status).toBe(413);
      });

      it("validates input and reports issues with 400", async () => {
        const ok = await json("/validated/7", send("POST", '{"name":"Ada"}', "application/json"));
        expect(ok).toMatchObject({ status: 200, body: { id: 7, name: "Ada" } });

        const bad = await json("/validated/x", send("POST", '{"name":""}', "application/json"));
        expect(bad.status).toBe(400);
        expect(bad.body.error.message).toBe("Validation failed");
        expect(
          bad.body.error.details.issues.map((i: { in: string; path: string[] }) => [i.in, i.path]),
        ).toEqual([
          ["params", ["id"]],
          ["body", ["name"]],
        ]);
      });
    });

    describe("methods", () => {
      it("answers unsupported methods with 405 and Allow", async () => {
        const response = await request("/health", { method: "DELETE" });
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("HEAD, GET, OPTIONS");
        expect(await response.json()).toEqual({
          error: { status: 405, message: "Method Not Allowed" },
        });
      });

      it("lets the most specific route claim a path for every method", async () => {
        expect((await request("/users/new", { method: "DELETE" })).status).toBe(405);
      });

      it("answers OPTIONS with 204 and Allow", async () => {
        const response = await request("/users", { method: "OPTIONS" });
        expect(response.status).toBe(204);
        expect(response.headers.get("allow")).toBe("HEAD, GET, POST, OPTIONS");
      });

      it("serves HEAD from GET without a body", async () => {
        const response = await request("/health", { method: "HEAD" });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("");
      });

      it("uses an explicit HEAD export when there is one", async () => {
        const response = await request("/head", { method: "HEAD" });
        expect(response.status).toBe(200);
        expect(response.headers.get("x-head")).toBe("explicit");
        expect((await json("/head")).body).toEqual({ get: true });
      });
    });

    describe("middleware", () => {
      it("runs root middleware for every route", async () => {
        expect((await json("/users/9")).body.requestId).toBe("none");
      });

      it("runs route group middleware only inside the group", async () => {
        const denied = await json("/admin-panel");
        expect(denied.status).toBe(401);
        expect(denied.headers.get("www-authenticate")).toBe("Bearer");

        const allowed = await json("/admin-panel", {
          headers: { authorization: "Bearer admin", "x-request-id": "r1" },
        });
        expect(allowed.body).toEqual({ admin: true, requestId: "r1" });
      });
    });
  });
}
