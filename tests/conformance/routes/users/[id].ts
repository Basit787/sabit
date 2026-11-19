import type { RouteContext } from "@sabit/router";

export function GET({ params, state }: RouteContext<"/users/[id]">) {
  return { id: params.id, requestId: state.requestId };
}

export function DELETE() {
  return undefined;
}
