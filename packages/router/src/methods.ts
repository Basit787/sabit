/*
 * HTTP methods a route module may export, in the order adapters register them.
 * HEAD comes before GET because Fastify auto-creates a HEAD route for every GET
 * route unless an explicit HEAD route was registered first.
 */
export const HTTP_METHODS = ["HEAD", "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

const METHOD_SET: ReadonlySet<string> = new Set(HTTP_METHODS);

export function isHttpMethod(value: string): value is HttpMethod {
  return METHOD_SET.has(value);
}
