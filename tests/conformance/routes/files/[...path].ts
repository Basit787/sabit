import type { RouteContext } from "@sabit/router";

export const GET = ({ params }: RouteContext<"/files/[...path]">) => ({ path: params.path });
