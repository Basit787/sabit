import { type AuthExport, ruleFor } from "./guard.ts";
import type { HttpMethod } from "./methods.ts";
import type { ComposedHandler, ResolvedRoute } from "./resolve.ts";
import type { Segment } from "./segments.ts";
import type { StandardSchemaV1 } from "./standard-schema.ts";

/*
 * What a route may export as `docs`: false hides it from the API docs; otherwise a summary per method
 * and tags (default: the first folder), e.g. { GET: "List users", POST: "Create a user" }.
 */
export type RouteDocs =
  | false
  | (Partial<Record<HttpMethod, string>> & { readonly tags?: readonly string[] });

/*
 * `title` and `version` of the API, and `access`: the access list of src/middleware.ts, so protected
 * routes show which sign-in they need (a route's own `auth` export counts too).
 */
export interface OpenApiOptions {
  readonly title?: string | undefined;
  readonly version?: string | undefined;
  readonly access?: Readonly<Record<string, AuthExport | undefined>> | undefined;
}

type JsonObject = Record<string, unknown>;

const BODY_METHODS: readonly HttpMethod[] = ["POST", "PUT", "PATCH"];

/*
 * An OpenAPI 3.1 document for the routes: paths and params from the folders, request bodies from
 * schema.ts (as JSON Schema), sign-in and roles from `access`. Built from the loaded routes, so it
 * always matches them; HEAD and OPTIONS are left out.
 */
export function openApiDocument(
  routes: readonly ResolvedRoute[],
  options: OpenApiOptions = {},
): JsonObject {
  const paths: Record<string, JsonObject> = {};
  for (const route of routes) {
    const docs = route.module.docs as RouteDocs | undefined;
    if (docs === false) continue;
    const item: JsonObject = {};
    for (const method of route.methods) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      item[method.toLowerCase()] = operation(route, method, docs, options);
    }
    if (Object.keys(item).length > 0) paths[openApiPath(route.segments)] = item;
  }
  return {
    openapi: "3.1.0",
    info: { title: options.title ?? "API", version: options.version ?? "1.0.0" },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };
}

function operation(
  route: ResolvedRoute,
  method: HttpMethod,
  docs: Exclude<RouteDocs, false> | undefined,
  options: OpenApiOptions,
): JsonObject {
  const responses: JsonObject = { "2XX": { description: "Success" } };
  const op: JsonObject = {
    tags: docs?.tags ?? [firstFolder(route.segments)],
    ...(docs?.[method] ? { summary: docs[method] } : {}),
  };
  const parameters = route.segments.flatMap((segment) => pathParameter(segment));
  if (parameters.length > 0) op.parameters = parameters;

  const schema = route.bodySchema;
  if (schema && BODY_METHODS.includes(method)) {
    op.requestBody = {
      required: true,
      content: { "application/json": { schema: bodySchema(schema, method) } },
    };
    responses["400"] = { description: "The body doesn't match schema.ts" };
  }

  const rule = (route.module.auth as AuthExport | undefined) ?? options.access?.[route.pattern];
  const required = ruleFor(rule, method);
  if (required !== undefined) {
    op.security = [{ bearerAuth: [] }];
    responses["401"] = { description: "Sign in first" };
    if (required !== true) {
      const roles = [required].flat().join(" or ");
      op.description = `Needs the role ${roles}.`;
      responses["403"] = { description: `Needs the role ${roles}` };
    }
  }
  op.responses = responses;
  return op;
}

// `/users/[id]` → `/users/{id}`; a catch-all is one {param} holding the rest of the path.
function openApiPath(segments: readonly Segment[]): string {
  const parts = segments.map((segment) =>
    segment.kind === "static" ? segment.value : `{${segment.name}}`,
  );
  return `/${parts.join("/")}`;
}

function pathParameter(segment: Segment): JsonObject[] {
  if (segment.kind === "static") return [];
  const rest = segment.kind !== "dynamic";
  return [
    {
      name: segment.name,
      in: "path",
      required: true,
      schema: { type: "string" },
      ...(rest ? { description: "The rest of the path, e.g. a/b/c" } : {}),
    },
  ];
}

function firstFolder(segments: readonly Segment[]): string {
  const first = segments[0];
  return first?.kind === "static" ? first.value : "root";
}

/*
 * schema.ts as JSON Schema, through Standard JSON Schema (Zod 4, @sabit/schema, ...): PATCH takes the
 * partial schema when there is one; dates become date-time strings; unknown libraries give any object.
 */
function bodySchema(validator: StandardSchemaV1, method: HttpMethod): JsonObject {
  const partial = (validator as { partial?: () => StandardSchemaV1 }).partial;
  const schema =
    method === "PATCH" && typeof partial === "function" ? partial.call(validator) : validator;
  const converter = (schema["~standard"] as { jsonSchema?: JsonSchemaConverter }).jsonSchema;
  if (!converter) return { type: "object" };
  try {
    const { $schema: _, ...json } = converter.input({
      target: "draft-2020-12",
      libraryOptions: { unrepresentable: "any", override: dateAsString },
    });
    return json;
  } catch {
    return { type: "object" };
  }
}

interface JsonSchemaConverter {
  input(options: { target: string; libraryOptions?: Record<string, unknown> }): JsonObject;
}

// Zod's hook for types JSON Schema lacks: a Date is sent as an ISO date-time string.
function dateAsString(ctx: {
  zodSchema?: { _zod?: { def?: { type?: string } } };
  jsonSchema: JsonObject;
}) {
  if (ctx.zodSchema?._zod?.def?.type !== "date") return;
  ctx.jsonSchema.type = "string";
  ctx.jsonSchema.format = "date-time";
}

const SWAGGER_UI = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1";

/*
 * A Swagger UI page for the OpenAPI document at `specUrl`. Its Content-Security-Policy allows only the
 * pinned Swagger UI files and this page's own script, so helmet's stricter default doesn't block it.
 */
export async function apiDocsPage(
  specUrl: string,
  options: { title?: string } = {},
): Promise<Response> {
  const script = `SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: "#docs", persistAuthorization: true });`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const title = (options.title ?? "API docs").replace(/[<>&"]/g, "");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css">
</head>
<body>
<div id="docs"></div>
<script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
<script>${script}</script>
</body>
</html>
`;
  const csp = [
    "default-src 'self'",
    `script-src https://cdn.jsdelivr.net 'sha256-${hash}'`,
    "style-src https://cdn.jsdelivr.net 'unsafe-inline'",
    "img-src 'self' data: https://cdn.jsdelivr.net",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": csp },
  });
}

// Whether the built-in docs are served: always in development, in production only with API_DOCS=true.
export function apiDocsEnabled(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.NODE_ENV !== "production" || env?.API_DOCS === "true";
}

/*
 * The built-in docs routes for `routes`: GET /docs (Swagger UI) and GET /docs/openapi.json. They skip
 * all middleware and are left out of the document itself.
 */
export function apiDocsRoutes(
  routes: readonly ResolvedRoute[],
  options: OpenApiOptions,
): ResolvedRoute[] {
  let document: JsonObject | undefined;
  const spec = async () => {
    document ??= openApiDocument(routes, options);
    return document;
  };
  const page = () => apiDocsPage("/docs/openapi.json", { title: options.title ?? "API docs" });
  return [builtIn(["docs"], page), builtIn(["docs", "openapi.json"], spec)];
}

function builtIn(parts: readonly string[], handler: ComposedHandler): ResolvedRoute {
  return {
    file: `(sabit)/${parts.join("/")}`,
    pattern: `/${parts.join("/")}`,
    segments: parts.map((value) => ({ kind: "static", value })),
    groups: [],
    paramNames: [],
    middleware: [],
    methods: ["GET"],
    allow: ["GET", "HEAD", "OPTIONS"],
    handlers: { GET: handler },
    module: { GET: handler, docs: false },
  };
}
