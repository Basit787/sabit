// Type-level tests. These run as part of `pnpm typecheck` (tsc checks test files);
// at runtime `expectTypeOf` is a no-op.
import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  createRoute,
  type Params,
  type ParamsOf,
  type Query,
  type RouteContext,
} from "../src/index.ts";

describe("ParamsOf", () => {
  it("infers params from a pattern", () => {
    expectTypeOf<ParamsOf<"/">>().toEqualTypeOf<Record<never, never>>();
    expectTypeOf<ParamsOf<"/users/[id]">>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<ParamsOf<"/orgs/[org]/repos/[repo]">>().toEqualTypeOf<{
      org: string;
      repo: string;
    }>();
    expectTypeOf<ParamsOf<"/files/[...path]">>().toEqualTypeOf<{ path: string[] }>();
    expectTypeOf<ParamsOf<"/docs/[[...slug]]">>().toEqualTypeOf<{ slug: string[] }>();
  });

  it("falls back to the generic shape for non-literal strings", () => {
    expectTypeOf<ParamsOf<string>>().toEqualTypeOf<Params>();
  });
});

describe("RouteContext", () => {
  it("accepts a pattern or an explicit params type", () => {
    expectTypeOf<RouteContext<"/users/[id]">["params"]>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<RouteContext<{ id: number }>["params"]>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<RouteContext["params"]>().toEqualTypeOf<Params>();
    expectTypeOf<RouteContext["query"]>().toEqualTypeOf<Query>();
    expectTypeOf<RouteContext["body"]>().toBeUnknown();
  });
});

describe("RouteContext assignability", () => {
  it("lets route-specific contexts flow into general helpers", () => {
    const helper = (ctx: RouteContext) => ctx.route;
    const typed = {} as RouteContext<"/users/[id]", { page: string }, { name: string }>;
    expectTypeOf(helper).parameter(0).toExtend<RouteContext>();
    helper(typed);
  });
});

describe("createRoute", () => {
  it("types params from the pattern", () => {
    createRoute("/users/[id]").handle((ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
      expectTypeOf(ctx.body).toBeUnknown();
    });
  });

  it("types validated inputs from schema outputs", () => {
    createRoute("/users/[id]").handle(
      {
        params: z.object({ id: z.coerce.number() }),
        query: z.object({ expand: z.string().optional() }),
        body: z.object({ name: z.string() }),
      },
      (ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ id: number }>();
        expectTypeOf(ctx.query).toEqualTypeOf<{ expand?: string | undefined }>();
        expectTypeOf(ctx.body).toEqualTypeOf<{ name: string }>();
      },
    );
  });

  it("keeps unvalidated parts at their defaults", () => {
    createRoute("/posts/[slug]").handle({ body: z.object({ title: z.string() }) }, (ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ slug: string }>();
      expectTypeOf(ctx.query).toEqualTypeOf<Query>();
    });
  });

  it("preserves the handler's result type", () => {
    const handler = createRoute("/").handle(() => ({ ok: true as const }));
    expectTypeOf(handler).returns.resolves.toEqualTypeOf<{ ok: true }>();
  });
});
