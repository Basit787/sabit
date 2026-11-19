import { type RouteContext, reply } from "@sabit/router";

export function GET({ query }: RouteContext) {
  return { users: [], query };
}

export function POST({ body }: RouteContext) {
  return reply(201, { created: body }, { location: "/users/1" });
}
