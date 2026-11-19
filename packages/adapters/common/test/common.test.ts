import { createContext, HttpError, resolveRoutes } from "@sabit/router";
import { describe, expect, it, vi } from "vitest";
import { corsOrigin, createRateLimiter, createRunner, readTextWithLimit } from "../src/index.ts";

async function route(GET: () => unknown) {
  const [resolved] = await resolveRoutes({ routes: [{ file: "x/api.ts", load: () => ({ GET }) }] });
  if (!resolved) throw new Error("no route");
  return resolved;
}
const ctx = (r: Awaited<ReturnType<typeof route>>) =>
  createContext(r, {
    method: "GET",
    url: "/x",
    params: {},
    headers: new Headers(),
    body: undefined,
    raw: { framework: "test" },
  });

describe("createRunner", () => {
  it("answers unexpected errors with a plain 500 and reports them", async () => {
    const r = await route(() => {
      throw new Error("password=secret");
    });
    const onError = vi.fn();
    const outcome = await createRunner({ onError })(r, "GET", ctx(r), "1.2.3.4");
    expect(outcome.status).toBe(500);
    expect(String(outcome.body)).not.toContain("secret");
    expect(JSON.parse(String(outcome.body))).toEqual({
      error: { status: 500, message: "Internal Server Error" },
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("keeps HttpErrors as they are", async () => {
    const r = await route(() => {
      throw new HttpError(404, "Nope");
    });
    expect((await createRunner()(r, "GET", ctx(r), undefined)).status).toBe(404);
  });

  it("rate limits per client", async () => {
    const r = await route(() => ({ ok: true }));
    const run = createRunner({ rateLimit: { max: 2 } });
    expect((await run(r, "GET", ctx(r), "a")).status).toBe(200);
    expect((await run(r, "GET", ctx(r), "a")).status).toBe(200);
    const limited = await run(r, "GET", ctx(r), "a");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await run(r, "GET", ctx(r), "b")).status).toBe(200);
  });
});

describe("createRateLimiter", () => {
  it("starts a new window after windowMs", () => {
    vi.useFakeTimers();
    const limit = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(limit("a")).toBeUndefined();
    expect(limit("a")?.status).toBe(429);
    vi.advanceTimersByTime(1001);
    expect(limit("a")).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("readTextWithLimit", () => {
  const stream = (text: string) => new Response(text).body as ReadableStream<Uint8Array>;
  it("reads bodies under the limit", async () => {
    expect(await readTextWithLimit(stream("hello"), "5", 10)).toBe("hello");
  });
  it("refuses bodies over the limit, by header or by size", async () => {
    await expect(readTextWithLimit(stream("x"), "11", 10)).rejects.toMatchObject({ status: 413 });
    await expect(readTextWithLimit(stream("x".repeat(11)), null, 10)).rejects.toMatchObject({
      status: 413,
    });
  });
});

describe("corsOrigin", () => {
  it("uses CORS_ORIGIN, allows any origin in development, refuses that in production", () => {
    expect(corsOrigin({ CORS_ORIGIN: "https://a.com, https://b.com" })).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
    expect(corsOrigin({})).toBe("*");
    expect(() => corsOrigin({ NODE_ENV: "production" })).toThrow(/CORS_ORIGIN/);
  });
});
