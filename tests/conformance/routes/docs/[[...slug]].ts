import type { RouteContext } from "@sabit/router";

export const GET = ({ params }: RouteContext<"/docs/[[...slug]]">) => ({ slug: params.slug });
