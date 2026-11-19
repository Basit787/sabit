import { HttpError } from "@sabit/router";

export function GET(): never {
  throw new HttpError(418, "I'm a teapot", {
    details: { brew: "tea" },
    headers: { "x-error": "yes" },
  });
}
