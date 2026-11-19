/**
 * Source templates for generated files. Output follows Biome/Prettier defaults
 * (2 spaces, double quotes) and passes the starters' ESLint and Biome configs.
 */

/** Displays a canonical pattern in the `:param` form people expect in URLs. */
export function displayPath(pattern: string): string {
  return pattern
    .replace(/\[\[\.\.\.(\w+)\]\]/g, "*$1?")
    .replace(/\[\.\.\.(\w+)\]/g, "*$1")
    .replace(/\[(\w+)\]/g, ":$1");
}

/** Names derived from a resource folder such as `users` or `blog-posts`. */
export interface ResourceNames {
  /** File name stem: `users` → `users.service.ts`. */
  readonly file: string;
  /** Service variable: `usersService`. */
  readonly service: string;
  /** Variable holding the sample data: `users`. */
  readonly data: string;
  /** Entity type: `User`. */
  readonly entity: string;
  /** Lowercase entity for messages: `user`. */
  readonly label: string;
}

export function resourceNames(folder: string): ResourceNames {
  const words = folder.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const safe = words.length > 0 ? words : ["resource"];
  const camel = safe
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0]?.toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
  const singularWords = [...safe.slice(0, -1), singular(safe.at(-1) as string)];
  const entity = singularWords.map((w) => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join("");
  const identifier = (name: string) => (/^[0-9]/.test(name) ? `_${name}` : name);
  return {
    file: folder,
    service: identifier(`${camel}Service`),
    data: RESERVED.has(camel) ? `${camel}List` : identifier(camel),
    entity: identifier(entity),
    label: singularWords.join(" ").toLowerCase(),
  };
}

const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static await".split(
    " ",
  ),
);

function singular(word: string): string {
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}

function capitalize(text: string): string {
  return text[0]?.toUpperCase() + text.slice(1);
}

/** `src/middleware.ts`: runs before every route and decides who may call what. */
export function appMiddlewareFile(): string {
  return `import { guard } from "@sabit/router";

// Runs before every route, like Next.js middleware.ts. List protected routes in
// \`rules\` (paths are folder paths: "/products", "/products/*", "/admin/**")
// and say who is calling in \`user\`. A request that matches no rule is public.
export default guard({
  rules: [
    // Creating and changing data needs a signed-in user...
    { path: "/**", methods: ["POST", "PUT", "PATCH", "DELETE"] },
    // ...and deleting needs an admin.
    { path: "/**", methods: ["DELETE"], role: "admin" },
  ],

  // Who is calling. Replace this with your real auth (verify a JWT, look up a
  // session...). For now "Authorization: Bearer <ADMIN_TOKEN>" is an admin and
  // "Bearer <AUTH_TOKEN>" is a user; without those env vars nobody is signed in.
  user(ctx) {
    const token = ctx.headers.get("authorization")?.replace(/^Bearer /, "");
    if (token && token === process.env.ADMIN_TOKEN) return { id: "admin", role: "admin" };
    if (token && token === process.env.AUTH_TOKEN) return { id: "user", role: "user" };
    return undefined;
  },
});
`;
}

/** `users/schema.ts`: what a user looks like; bodies in this folder are checked against it. */
export function folderSchemaFile(label = "item"): string {
  return `import { defineSchema } from "@sabit/schema";

// What a ${label} looks like. POST and PUT bodies for routes in this folder must
// match it; PATCH checks only the fields sent. Mongoose-style fields:
//   { type: String | Number | Boolean | Date, required, default, enum,
//     min, max, minLength, maxLength, match, trim, lowercase }
//   [String] for a list, { city: String } for a nested object.
export default defineSchema({
  name: { type: String, required: true, trim: true },
});
`;
}

/** `users/api.ts`: the data, list and create. */
export function collectionRoute(pattern: string, names: ResourceNames, ext: string): string {
  const { entity, data, label } = names;
  const url = displayPath(pattern);
  return `// Endpoints for ${url}. Each export named after an HTTP method (GET, POST, ...)
// handles that method; what it returns is sent as JSON. Bodies are checked
// against ./schema.ts; who may call what is decided in src/middleware.ts.
import { type RouteContext, reply } from "@sabit/router";
import type { Infer } from "@sabit/schema";
import type schema from "./schema${ext}";

export type ${entity} = Infer<typeof schema> & { id: string };

// Sample data kept in memory; replace with your database.
export const ${data}: ${entity}[] = [
  { id: "1", name: "Sample ${label} 1" },
  { id: "2", name: "Sample ${label} 2" },
];

// GET ${url}: list ${label}s
export const GET = () => ${data};

// POST ${url}: create a ${label}
export const POST = ({ body }: RouteContext) => {
  const created = { ...(body as ${entity}), id: String(Date.now()) };
  ${data}.push(created);
  return reply(201, created);
};
`;
}

/** `users/[id]/api.ts`: get, replace, update and delete one item. */
export function itemRoute(
  pattern: string,
  names: ResourceNames,
  param: string,
  ext: string,
): string {
  const { entity, data, label } = names;
  const url = displayPath(pattern);
  return `// Endpoints for ${url}. params.${param} is the :${param} part of the URL. Bodies
// are checked against ../schema.ts (PATCH: only the fields sent).
import { HttpError, type RouteContext } from "@sabit/router";
import { type ${entity}, ${data} } from "../api${ext}";

type Context = RouteContext<"${pattern}">;

// GET ${url}: get one ${label}
export const GET = ({ params }: Context) => find(params.${param});

// PUT ${url}: replace a ${label}
export const PUT = ({ params, body }: Context) => {
  const replaced = { ...(body as ${entity}), id: params.${param} };
  ${data}[${data}.indexOf(find(params.${param}))] = replaced;
  return replaced;
};

// PATCH ${url}: change some fields of a ${label}
export const PATCH = ({ params, body }: Context) => {
  return Object.assign(find(params.${param}), body as Partial<${entity}>, { id: params.${param} });
};

// DELETE ${url}: delete a ${label}
export const DELETE = ({ params }: Context) => {
  ${data}.splice(${data}.indexOf(find(params.${param})), 1);
};

function find(${param}: string) {
  const found = ${data}.find((item) => item.id === ${param});
  if (!found) throw new HttpError(404, "${capitalize(label)} not found");
  return found;
}
`;
}

/** A dynamic folder created on its own (e.g. `orders/[orderId]`): standalone handlers. */
export function standaloneItemRoute(pattern: string, param: string): string {
  const url = displayPath(pattern);
  return `import type { RouteContext } from "@sabit/router";

type Context = RouteContext<"${pattern}">;

// GET ${url}
export async function GET({ params }: Context) {
  // TODO: load the item
  return { data: { ${param}: params.${param} } };
}

// PATCH ${url}
export async function PATCH({ params, body }: Context) {
  // TODO: update the item
  return { data: { ...(body as object), ${param}: params.${param} } };
}

// DELETE ${url}
export async function DELETE({ params }: Context) {
  // TODO: delete the item
  return { data: { ${param}: params.${param}, deleted: true } };
}
`;
}

/** A catch-all folder (`[...path]`) gets a read-only handler. */
export function catchAllRoute(pattern: string, param: string): string {
  const url = displayPath(pattern);
  return `import type { RouteContext } from "@sabit/router";

// GET ${url}
export async function GET({ params }: RouteContext<"${pattern}">) {
  return { ${param}: params.${param} };
}
`;
}
