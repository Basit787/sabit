import { HttpError, type Middleware } from "../../../../../src/index.ts";

const requireAuth: Middleware = async (ctx, next) => {
  if (ctx.headers.get("authorization") !== "Bearer secret") throw new HttpError(401);
  (ctx.state.trace as string[]).push("protected");
  return next();
};

export default requireAuth;
