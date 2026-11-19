import type { RouteContext } from "../../../../../src/index.ts";

export const GET = ({ state }: RouteContext) => ({ route: "dashboard", trace: state.trace });
