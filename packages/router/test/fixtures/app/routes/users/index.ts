import type { RouteContext } from "../../../../../src/index.ts";

export function GET({ state }: RouteContext) {
  return { route: "users", trace: state.trace };
}

export function POST({ body }: RouteContext) {
  return { created: body };
}
