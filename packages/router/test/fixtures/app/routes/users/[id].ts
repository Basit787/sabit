import type { RouteContext } from "../../../../../src/index.ts";

export async function GET({ params, state }: RouteContext<"/users/[id]">) {
  return { userId: params.id, trace: state.trace };
}

export async function DELETE({ params }: RouteContext<"/users/[id]">) {
  return { deleted: params.id };
}
