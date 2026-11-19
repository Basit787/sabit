import type { Middleware } from "../../../../src/index.ts";

const trace: Middleware = async (ctx, next) => {
  ctx.state.trace = ["root"];
  return next();
};

export default trace;
