import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRoute, HttpError, type StandardSchemaV1 } from "../src/index.ts";
import { makeContext } from "./helpers.ts";

describe("createRoute", () => {
  it("rejects malformed patterns early", () => {
    expect(() => createRoute("users")).toThrow(/must start with "\/"/);
    expect(() => createRoute("/users/[1d]")).toThrow(/not a valid param name/);
  });

  it("calls the handler with the context", async () => {
    const handler = createRoute("/users/[id]").handle(({ params }) => ({ id: params.id }));
    const ctx = makeContext("/users/[id]", { params: { id: "7" } });
    expect(await handler(ctx)).toEqual({ id: "7" });
  });

  describe("validation", () => {
    const route = createRoute("/users/[id]");
    const handler = route.handle(
      {
        params: z.object({ id: z.coerce.number().int() }),
        query: z.object({ verbose: z.enum(["true", "false"]).optional() }),
        body: z.object({ name: z.string().min(1) }),
      },
      ({ params, query, body }) => ({ params, query, body }),
    );

    it("passes schema outputs to the handler", async () => {
      const ctx = makeContext("/users/[id]", {
        params: { id: "42" },
        url: "/users/42?verbose=true",
        body: { name: "Ada", extra: "stripped by zod" },
      });
      expect(await handler(ctx)).toEqual({
        params: { id: 42 },
        query: { verbose: "true" },
        body: { name: "Ada" },
      });
    });

    it("responds 400 with issues from every invalid part", async () => {
      const ctx = makeContext("/users/[id]", {
        params: { id: "abc" },
        body: { name: "" },
      });
      const error = await handler(ctx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(400);
      const { issues } = (error as HttpError).details as {
        issues: Array<{ in: string; path: unknown[] }>;
      };
      expect(issues.map((i) => [i.in, i.path])).toEqual([
        ["params", ["id"]],
        ["body", ["name"]],
      ]);
    });

    it("works with any Standard Schema implementation, including async ones", async () => {
      const upper: StandardSchemaV1<unknown, string> = {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: async (value) =>
            typeof value === "string"
              ? { value: value.toUpperCase() }
              : { issues: [{ message: "expected a string", path: [{ key: "root" }] }] },
        },
      };
      const h = createRoute("/").handle({ body: upper }, ({ body }) => body);
      expect(await h(makeContext("/", { body: "hi" }))).toBe("HI");
      const error = (await h(makeContext("/", { body: 1 })).catch((e: unknown) => e)) as HttpError;
      expect(error.details).toEqual({
        issues: [{ in: "body", path: ["root"], message: "expected a string" }],
      });
    });

    it("does not mutate the original context", async () => {
      const ctx = makeContext("/users/[id]", { params: { id: "1" }, body: { name: "x" } });
      await handler(ctx);
      expect(ctx.params).toEqual({ id: "1" });
    });
  });
});
