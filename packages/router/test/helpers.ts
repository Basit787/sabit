import { type ContextInit, createContext, type RouteContext } from "../src/index.ts";
import { parseRoutePath } from "../src/segments.ts";

/** Builds a context the way an adapter would, for a pattern like `/users/[id]`. */
export function makeContext(pattern = "/", init: Partial<ContextInit> = {}): RouteContext {
  const parsed = pattern === "/" ? parseRoutePath("index") : parseRoutePath(pattern.slice(1));
  return createContext(parsed, {
    method: "GET",
    url: "/",
    params: {},
    headers: new Headers(),
    body: undefined,
    raw: { framework: "test" },
    ...init,
  });
}

export async function readBody(body: unknown): Promise<string | null> {
  if (body === null) return null;
  return new Response(body as BodyInit).text();
}
