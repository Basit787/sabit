import { reply } from "@sabit/router";

export const GET = () =>
  reply(200, { ok: true }, [
    ["set-cookie", "a=1; Path=/"],
    ["set-cookie", "b=2; Path=/"],
  ]);
