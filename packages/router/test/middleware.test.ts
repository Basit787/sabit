import { describe, expect, it } from "vitest";
import {
  composeMiddleware,
  createRoute,
  HttpError,
  type Middleware,
  type ModuleSource,
  type RouteContext,
  reply,
  resolveRoutes,
  withMiddleware,
} from "../src/index.ts";
import { makeContext } from "./helpers.ts";

describe("composeMiddleware", () => {
  it("runs middleware outermost-first around the handler (onion order)", async () => {
    const log: string[] = [];
    const tracer =
      (name: string): Middleware =>
      async (_ctx, next) => {
        log.push(`${name}:before`);
        await next();
        log.push(`${name}:after`);
      };
    const run = composeMiddleware([tracer("a"), tracer("b")], () => {
      log.push("handler");
      return "done";
    });

    expect(await run(makeContext())).toBe("done");
    expect(log).toEqual(["a:before", "b:before", "handler", "b:after", "a:after"]);
  });

  it("calls the handler directly when there is no middleware", async () => {
    const run = composeMiddleware([], () => 42);
    expect(await run(makeContext())).toBe(42);
  });

  it("lets middleware short-circuit by returning a value", async () => {
    let handlerRan = false;
    const run = composeMiddleware([() => reply(429, { error: "slow down" })], () => {
      handlerRan = true;
    });
    expect(await run(makeContext())).toMatchObject({ status: 429 });
    expect(handlerRan).toBe(false);
  });

  it("lets middleware short-circuit by throwing", async () => {
    const run = composeMiddleware(
      [
        () => {
          throw new HttpError(401);
        },
      ],
      () => "secret",
    );
    await expect(run(makeContext())).rejects.toMatchObject({ status: 401 });
  });

  it("lets middleware replace the downstream result", async () => {
    const wrap: Middleware = async (_ctx, next) => ({ data: await next() });
    const run = composeMiddleware([wrap], () => [1, 2]);
    expect(await run(makeContext())).toEqual({ data: [1, 2] });
  });

  it("keeps the downstream result when middleware returns undefined after next()", async () => {
    const run = composeMiddleware(
      [
        async (_ctx, next) => {
          await next();
        },
      ],
      () => "kept",
    );
    expect(await run(makeContext())).toBe("kept");
  });

  it("shares state between middleware and handler", async () => {
    const run = composeMiddleware(
      [
        (ctx, next) => {
          ctx.state.user = { id: "u1" };
          return next();
        },
      ],
      (ctx) => ctx.state.user,
    );
    expect(await run(makeContext())).toEqual({ id: "u1" });
  });

  it("gives each request its own state", async () => {
    const run = composeMiddleware(
      [
        (ctx, next) => {
          ctx.state.count = ((ctx.state.count as number | undefined) ?? 0) + 1;
          return next();
        },
      ],
      (ctx) => ctx.state.count,
    );
    expect(await run(makeContext())).toBe(1);
    expect(await run(makeContext())).toBe(1);
  });

  it("rejects calling next() twice", async () => {
    const run = composeMiddleware(
      [
        async (_ctx, next) => {
          await next();
          await next();
        },
      ],
      () => "x",
    );
    await expect(run(makeContext())).rejects.toThrow(/more than once/);
  });

  it("explains a middleware that forgot to call next()", async () => {
    const forgetful: Middleware = function checkAuth() {};
    const run = composeMiddleware([forgetful], () => "x");
    await expect(run(makeContext("/users/[id]"))).rejects.toThrow(
      /middleware "checkAuth" for \/users\/\[id\] neither called next\(\)/,
    );
  });
});

describe("withMiddleware", () => {
  const requireToken: Middleware = (ctx, next) => {
    if (ctx.headers.get("authorization") !== "Bearer t") throw new HttpError(401);
    ctx.state.user = "u1";
    return next();
  };
  const auth = withMiddleware(requireToken);

  it("protects one handler and leaves others public", async () => {
    const GET = () => "public";
    const POST = auth(({ state }: RouteContext) => ({ by: state.user }));
    expect(await GET()).toBe("public");
    await expect(POST(makeContext("/"))).rejects.toMatchObject({ status: 401 });
    const signedIn = makeContext("/", { headers: new Headers({ authorization: "Bearer t" }) });
    expect(await POST(signedIn)).toEqual({ by: "u1" });
  });

  it("keeps the handler's typed context and createRoute() pattern check", async () => {
    const PUT = auth(createRoute("/items/[id]").handle(({ params }) => params.id));
    const source = (file: string, mod: unknown): ModuleSource => ({ file, load: () => mod });
    await expect(
      resolveRoutes({ routes: [source("items/[id].ts", { PUT })] }),
    ).resolves.toHaveLength(1);
    await expect(resolveRoutes({ routes: [source("other/[id].ts", { PUT })] })).rejects.toThrow(
      /createRoute\("\/items\/\[id\]"\)/,
    );
  });
});
