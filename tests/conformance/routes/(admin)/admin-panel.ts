import type { RouteContext } from "@sabit/router";

export const GET = ({ state }: RouteContext) => ({
  admin: state.admin,
  requestId: state.requestId,
});
