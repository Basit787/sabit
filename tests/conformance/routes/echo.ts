import type { RouteContext } from "@sabit/router";

const echo = ({ body, headers }: RouteContext) => ({
  body: body ?? null,
  contentType: headers.get("content-type"),
});

export const POST = echo;
export const PUT = echo;
