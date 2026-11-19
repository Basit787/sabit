import type { RouteContext } from "../../../../../src/index.ts";

export const GET = ({ params }: RouteContext<"/files/[...path]">) => ({ path: params.path });
