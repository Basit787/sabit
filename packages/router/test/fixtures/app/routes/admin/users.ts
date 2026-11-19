import type { Middleware, RouteContext } from "../../../../../src/index.ts";

export const middleware: Middleware[] = [
  async (ctx, next) => {
    (ctx.state.trace as string[]).push("admin/users route");
    return next();
  },
];

export const GET = ({ state }: RouteContext) => ({ trace: state.trace });
