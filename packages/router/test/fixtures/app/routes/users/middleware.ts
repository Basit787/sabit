import type { Middleware } from "../../../../../src/index.ts";

export default [
  async (ctx, next) => {
    (ctx.state.trace as string[]).push("users");
    return next();
  },
] satisfies Middleware[];
