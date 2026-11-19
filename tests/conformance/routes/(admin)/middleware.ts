import { defineMiddleware, HttpError } from "@sabit/router";

export default defineMiddleware(async (ctx, next) => {
  if (ctx.headers.get("authorization") !== "Bearer admin") {
    throw new HttpError(401, "Unauthorized", { headers: { "www-authenticate": "Bearer" } });
  }
  ctx.state.admin = true;
  return next();
});
