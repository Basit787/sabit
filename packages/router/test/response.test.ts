import { describe, expect, it } from "vitest";
import {
  errorOutcome,
  HttpError,
  isHttpError,
  outcomeToResponse,
  reply,
  toOutcome,
} from "../src/index.ts";
import { readBody } from "./helpers.ts";

describe("toOutcome", () => {
  it("sends 204 for undefined", async () => {
    const outcome = await toOutcome(undefined);
    expect(outcome.status).toBe(204);
    expect(outcome.body).toBeNull();
  });

  it("sends strings as text", async () => {
    const outcome = await toOutcome("hello");
    expect(outcome.status).toBe(200);
    expect(outcome.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(outcome.body).toBe("hello");
  });

  it.each([[{ a: 1 }], [[1, 2]], [null], [0], [false]])("sends %j as JSON", async (value) => {
    const outcome = await toOutcome(value);
    expect(outcome.status).toBe(200);
    expect(outcome.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(outcome.body).toBe(JSON.stringify(value));
  });

  it("sends bytes as octet-stream", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect((await toOutcome(bytes)).body).toBe(bytes);
    expect((await toOutcome(bytes.buffer)).headers.get("content-type")).toBe(
      "application/octet-stream",
    );
  });

  it("passes web Responses through", async () => {
    const outcome = await toOutcome(
      new Response("<p>hi</p>", { status: 202, headers: { "content-type": "text/html" } }),
    );
    expect(outcome.status).toBe(202);
    expect(outcome.headers.get("content-type")).toBe("text/html");
    expect(await readBody(outcome.body)).toBe("<p>hi</p>");
  });

  it("applies reply() status and headers", async () => {
    const outcome = await toOutcome(reply(201, { id: 1 }, { location: "/things/1" }));
    expect(outcome.status).toBe(201);
    expect(outcome.headers.get("location")).toBe("/things/1");
    expect(outcome.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(outcome.body).toBe('{"id":1}');
  });

  it("keeps an explicit content-type from reply()", async () => {
    const outcome = await toOutcome(reply(200, "<b>x</b>", { "content-type": "text/html" }));
    expect(outcome.headers.get("content-type")).toBe("text/html");
  });

  it("allows reply() without a body", async () => {
    const outcome = await toOutcome(reply(202));
    expect(outcome.status).toBe(202);
    expect(outcome.body).toBeNull();
  });

  it("rejects invalid statuses", () => {
    expect(() => reply(99)).toThrow(RangeError);
    expect(() => reply(600)).toThrow(RangeError);
  });
});

describe("HttpError", () => {
  it("serializes to a consistent JSON shape", async () => {
    const outcome = errorOutcome(
      new HttpError(401, "Token expired", {
        headers: { "www-authenticate": "Bearer" },
        details: { reason: "expired" },
      }),
    );
    expect(outcome.status).toBe(401);
    expect(outcome.headers.get("www-authenticate")).toBe("Bearer");
    expect(JSON.parse(String(outcome.body))).toEqual({
      error: { status: 401, message: "Token expired", details: { reason: "expired" } },
    });
  });

  it("has default messages", () => {
    expect(new HttpError(404).message).toBe("Not Found");
    expect(new HttpError(503).message).toBe("Internal Server Error");
  });

  it("only accepts error statuses", () => {
    expect(() => new HttpError(200)).toThrow(RangeError);
  });

  it("is recognized across package copies", () => {
    const foreign = Object.assign(new Error("x"), {
      [Symbol.for("sabit.http-error")]: true,
    });
    expect(isHttpError(foreign)).toBe(true);
    expect(isHttpError(new Error("x"))).toBe(false);
  });
});

describe("outcomeToResponse", () => {
  it("builds a web Response", async () => {
    const response = outcomeToResponse(await toOutcome(reply(201, { ok: true })));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
  });
});
