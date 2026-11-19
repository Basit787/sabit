import type { RouteContext } from "../../../../../src/index.ts";

export const GET = ({ params }: RouteContext<"/docs/[[...slug]]">) => ({ slug: params.slug });
