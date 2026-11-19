import { defineMiddleware } from "@sabit/router";

export default defineMiddleware(async (ctx, next) => {
  ctx.state.requestId = ctx.headers.get("x-request-id") ?? "none";
  return next();
});
