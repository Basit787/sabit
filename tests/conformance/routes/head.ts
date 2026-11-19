import { reply } from "@sabit/router";

export const HEAD = () => reply(200, undefined, { "x-head": "explicit" });
export const GET = () => ({ get: true });
