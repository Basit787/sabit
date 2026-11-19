import type { AuthKind } from "./auth-files.ts";
/*
 * Source templates for generated files. Output follows Biome/Prettier defaults
 * (2 spaces, double quotes) and passes the starters' ESLint and Biome configs.
 */

import type { PackageManager } from "./project.ts";
import { type Database, databaseName } from "./stack.ts";

// Displays a canonical pattern in the `:param` form people expect in URLs.
export function displayPath(pattern: string): string {
  return pattern
    .replace(/\[\[\.\.\.(\w+)\]\]/g, "*$1?")
    .replace(/\[\.\.\.(\w+)\]/g, "*$1")
    .replace(/\[(\w+)\]/g, ":$1");
}

/*
 * Names derived from a resource folder such as `users` or `blog-posts`: `file` stem, `service` and `data`
 * variables, `entity` type (User) and lowercase `label` for messages.
 */
export interface ResourceNames {
  readonly file: string;
  readonly service: string;
  readonly data: string;
  readonly entity: string;
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

/*
 * `src/middleware.ts`: signs the caller in with src/auth/ and checks the access list of every
 * route. `routes` are the list's first entries (pattern, rule); `ext` the import extension.
 */
export function appMiddlewareFile(
  routes: ReadonlyArray<readonly [string, string]> = [],
  ext = ".ts",
): string {
  const entries = routes
    .map(([pattern, rule]) => `  ${JSON.stringify(pattern)}: ${rule},\n`)
    .join("");
  return `import {
  type AuthExport,
  checkAccess,
  HttpError,
  isHttpError,
  type Middleware,
} from "@sabit/router";
import { currentUser } from "./auth/index${ext}";
import type { RoutePattern } from "./sabit.route${ext}";

/*
 * Who may call each route (RoutePattern lists them all): false = public, true = signed in,
 * "admin" = that role, { POST: true, DELETE: "admin" } = per method. No user: 401; no role: 403.
 */
export const access: Partial<Record<RoutePattern, AuthExport>> = {
${entries}  ${ACCESS_MARKER}
};

/*
 * Runs before every request, like app.use() in Express: signs the caller in (src/auth/), checks
 * the access list, then the route runs. HttpErrors answer as they are; anything else is logged, then 500.
 */
const middleware: Middleware = async (ctx, next) => {
  try {
    ctx.state.user = await currentUser(ctx);
    checkAccess(ctx, access[ctx.route as RoutePattern]);
    return await next();
  } catch (error) {
    if (isHttpError(error)) throw error;
    console.error(\`\${ctx.method} \${ctx.path} failed:\`, error);
    throw new HttpError(500, "Something went wrong");
  }
};

export default middleware;
`;
}

// Docs routes an earlier sabit wrote into src/routes/docs/; the API docs are built in now.
export const OLD_DOCS_FILES = ["src/routes/docs/api.ts", "src/routes/docs/openapi.json/api.ts"];

// Line in src/middleware.ts's access list that new routes are added above.
export const ACCESS_MARKER = "// sabit adds new routes above this line.";

// A routes folder's `middleware.ts`: runs before the routes in that folder and below.
export function folderMiddlewareFile(): string {
  return `import { HttpError, isHttpError, type Middleware } from "@sabit/router";

/*
 * Runs before every route in this folder and below, after src/middleware.ts (ctx.state.user is set).
 * Check what you need, e.g. throw new HttpError(401, "Missing API key") without an x-api-key header,
 * then call next(). HttpErrors answer as they are; anything else is logged, then 500.
 */
const middleware: Middleware = async (ctx, next) => {
  try {
    return await next();
  } catch (error) {
    if (isHttpError(error)) throw error;
    console.error(\`\${ctx.method} \${ctx.path} failed:\`, error);
    throw new HttpError(500, "Something went wrong");
  }
};

export default middleware;
`;
}

// `users/schema.ts`: what a user looks like; bodies in this folder are checked against it.
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

/*
 * The `auth` export of a generated route: who may call which method. The
 * project's src/middleware.ts (a guard) says who is calling.
 */
export function authExport(value: string): string {
  return `
// Who may call what: true = any signed-in user, "admin" = that role (who is
// signed in comes from src/middleware.ts). Leave a method out to make it public.
export const auth = ${value};
`;
}

// `users/api.ts`: the data, list and create.
export function collectionRoute(pattern: string, names: ResourceNames, auth = true): string {
  const { entity, data, label } = names;
  const url = displayPath(pattern);
  return `// Endpoints for ${url}. Each export named after an HTTP method (GET, POST, ...)
// handles that method; what it returns is sent as JSON. Bodies are checked
// against ./schema.ts.
import { type RouteContext, reply } from "@sabit/router";
${auth ? authExport("{ POST: true }") : ""}
export type ${entity} = { id: string; name: string };

// Sample data kept in memory; replace with your database.
export const ${data}: ${entity}[] = [
  { id: "1", name: "Sample ${label} 1" },
  { id: "2", name: "Sample ${label} 2" },
];

// GET ${url}: list ${label}s
export const GET = () => ${data};

// POST ${url}: create a ${label}
export const POST = ({ body }: RouteContext) => {
  const created = { ...(body as ${entity}), id: crypto.randomUUID() };
  ${data}.push(created);
  return reply(201, created);
};
`;
}

// `users/[id]/api.ts`: get, replace, update and delete one item.
export function itemRoute(
  pattern: string,
  names: ResourceNames,
  param: string,
  ext: string,
  auth = true,
): string {
  const { entity, data, label } = names;
  const url = displayPath(pattern);
  return `// Endpoints for ${url}. params.${param} is the :${param} part of the URL.
import { HttpError, type RouteContext } from "@sabit/router";
import { type ${entity}, ${data} } from "../api${ext}";

type Context = RouteContext<"${pattern}">;
${auth ? authExport('{ PUT: true, PATCH: true, DELETE: "admin" }') : ""}
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

// A dynamic folder created on its own (e.g. `orders/[orderId]`): standalone handlers.
export function standaloneItemRoute(pattern: string, param: string, auth = true): string {
  const url = displayPath(pattern);
  return `import type { RouteContext } from "@sabit/router";

type Context = RouteContext<"${pattern}">;
${auth ? authExport('{ PATCH: true, DELETE: "admin" }') : ""}
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

// A catch-all folder (`[...path]`) gets a read-only handler.
export function catchAllRoute(pattern: string, param: string): string {
  const url = displayPath(pattern);
  return `import type { RouteContext } from "@sabit/router";

// GET ${url}
export async function GET({ params }: RouteContext<"${pattern}">) {
  return { ${param}: params.${param} };
}
`;
}

// Install commands and files for each package manager inside the Dockerfile.
const DOCKER_PM: Record<
  PackageManager,
  { setup: string; files: string; install: string; prod: string }
> = {
  npm: {
    setup: "",
    files: "package.json package-lock.json",
    install: "npm ci",
    prod: "npm ci --omit=dev",
  },
  pnpm: {
    setup: "RUN npm install --global pnpm\n",
    files: "package.json pnpm-lock.yaml pnpm-workspace.yaml*",
    install: "pnpm install --frozen-lockfile",
    prod: "pnpm install --frozen-lockfile --prod",
  },
  yarn: {
    setup: "",
    files: "package.json yarn.lock",
    install: "yarn install --frozen-lockfile",
    prod: "yarn install --frozen-lockfile --production",
  },
  bun: {
    setup: "COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun\n",
    files: "package.json bun.lock",
    install: "bun install --frozen-lockfile",
    prod: "bun install --frozen-lockfile --production",
  },
};

/*
 * `Dockerfile`, multi-stage: `dev` runs the dev server (docker-compose.yml uses
 * it with your source mounted); the last stage, built by default, holds only
 * dist/ and production dependencies.
 */
export function dockerfile(
  pm: PackageManager,
  main: string,
  options: { prismaEngine?: boolean; localRegistry?: boolean } = {},
): string {
  const { setup, files, install, prod } = DOCKER_PM[pm];
  const openssl = options.prismaEngine ? OPENSSL : "";
  const registry = options.localRegistry
    ? "# The registry runs on your machine, which is host.docker.internal from inside Docker.\n" +
      'RUN sed -i -e "s#//localhost#//host.docker.internal#g" -e "s#//127\\.0\\.0\\.1#//host.docker.internal#g" .npmrc\n'
    : "";
  const generate = options.prismaEngine
    ? "# Prisma's client lives in node_modules, so generate it for this image.\nCOPY prisma ./prisma\nRUN npx prisma generate\n"
    : "";
  return `# Dependencies, shared by the stages below.
FROM node:22-alpine AS deps
WORKDIR /app
${openssl}${setup}COPY ${files} .npmrc* ./
${registry}RUN ${install}

# Development: docker-compose.yml runs this stage with your source mounted over
# /app, so the server reloads on save and new route folders get their files.
FROM deps AS dev
ENV HOST=0.0.0.0 PORT=3000
COPY . .
EXPOSE 3000
CMD ["${pm}", "run", "dev"]

# Build: compile TypeScript into dist/.
FROM deps AS build
COPY . .
RUN ${pm} run build

# Production (the default when you run \`docker build .\`): dist/ and production
# dependencies only.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
${openssl}${setup}COPY ${files} .npmrc* ./
${registry}RUN ${prod}
${generate}COPY --from=build /app/dist ./dist
# Not root: a compromised app can't change the image or install anything.
USER node
EXPOSE 3000
CMD ["node", "${main}"]
`;
}

// Line every generated `src/env.ts` has; only files with it are rewritten.
export const ENV_FILE_MARKER =
  "// Reads .env in development. Variables already set (Docker, production) win.";

// `src/env.ts`: loads .env and exports each key found in .env / .env.example as `ENV`.
export function envFile(keys: readonly string[]): string {
  const entries = keys.map((key) => `  ${key}: process.env.${key},\n`).join("");
  return `// Generated by sabit from the keys in .env and .env.example; \`sabit dev\` rewrites
// it when those files change, so add variables there.
import { existsSync } from "node:fs";

${ENV_FILE_MARKER}
if (existsSync(".env")) process.loadEnvFile();

export const ENV = {${entries ? `\n${entries}` : ""}};
`;
}

// Prisma 6's query engine needs OpenSSL, which Alpine doesn't ship.
const OPENSSL = "RUN apk add --no-cache openssl\n";

// `.dockerignore`: keeps local installs, build output and secrets out of the image.
export function dockerignoreFile(): string {
  return `node_modules
dist
.git
.env
.env.*
*.log
`;
}

// Services the compose files can run next to the database.
export type Service = "redis" | "kafka" | "rabbitmq" | "mailpit";

/*
 * What goes in docker-compose.yml: the `app` too (from the Dockerfile's dev stage), the database, the
 * services, and `localRegistry` (the project installs from a registry on this machine).
 */
export interface ComposeServices {
  readonly app: boolean;
  readonly database?: Database | undefined;
  readonly services: readonly Service[];
  readonly localRegistry?: boolean;
}

/*
 * A compose service: image, environment, command, `healthcheck` lines, `ports` (published to your machine),
 * a volume, and `env`: how the app reaches it from inside Docker, as `KEY: value`.
 */
interface ServiceSpec {
  readonly image: string;
  readonly environment?: readonly string[];
  readonly command?: string;
  readonly healthcheck?: readonly string[];
  readonly ports?: readonly string[];
  readonly volume?: string;
  readonly env?: string;
}

/*
 * Compose services. MongoDB runs as a one-node replica set (Prisma needs one, and it enables transactions);
 * Kafka is one broker+controller, localhost:9092 from your machine and kafka:19092 from other containers.
 */
function serviceSpecs(db: string): Record<Database | Service, ServiceSpec> {
  const password = "postgres";
  return {
    postgres: {
      image: "postgres:17-alpine",
      environment: [
        "POSTGRES_USER: postgres",
        `POSTGRES_PASSWORD: ${password}`,
        `POSTGRES_DB: ${db}`,
      ],
      healthcheck: ['test: ["CMD-SHELL", "pg_isready -U postgres"]', "interval: 2s", "retries: 30"],
      ports: ['"127.0.0.1:5432:5432"'],
      volume: "postgres-data:/var/lib/postgresql/data",
      env: `DATABASE_URL: postgres://postgres:${password}@postgres:5432/${db}`,
    },
    mongodb: {
      image: "mongo:8",
      command: '["--replSet", "rs0", "--bind_ip_all"]',
      healthcheck: [
        `test: ["CMD", "mongosh", "--quiet", "--eval", "try { rs.status() } catch { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] }) }"]`,
        "interval: 5s",
      ],
      ports: ['"127.0.0.1:27017:27017"'],
      volume: "mongodb-data:/data/db",
      env: `MONGODB_URI: mongodb://mongodb:27017/${db}?directConnection=true`,
    },
    redis: {
      image: "redis:8-alpine",
      ports: ['"127.0.0.1:6379:6379"'],
      volume: "redis-data:/data",
      env: "REDIS_URL: redis://redis:6379",
    },
    kafka: {
      image: "apache/kafka:4.1.0",
      environment: [
        "KAFKA_NODE_ID: 1",
        "KAFKA_PROCESS_ROLES: broker,controller",
        "KAFKA_LISTENERS: PLAINTEXT://:19092,CONTROLLER://:9093,PLAINTEXT_HOST://:9092",
        "KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:19092,PLAINTEXT_HOST://localhost:9092",
        "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT",
        "KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER",
        "KAFKA_CONTROLLER_QUORUM_VOTERS: 1@localhost:9093",
        "KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT",
        "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1",
      ],
      ports: ['"127.0.0.1:9092:9092"'],
      env: "KAFKA_BROKERS: kafka:19092",
    },
    rabbitmq: {
      image: "rabbitmq:4-management-alpine",
      ports: [
        '"127.0.0.1:5672:5672" # AMQP',
        '"127.0.0.1:15672:15672" # management UI, guest / guest',
      ],
      volume: "rabbitmq-data:/var/lib/rabbitmq",
      env: "RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672",
    },
    mailpit: {
      image: "axllent/mailpit",
      ports: [
        '"127.0.0.1:1025:1025" # SMTP',
        '"127.0.0.1:8025:8025" # web UI with every email sent',
      ],
      env: "SMTP_URL: smtp://mailpit:1025",
    },
  };
}

const list = (key: string, items: readonly string[], indent = "    ") =>
  items.length > 0 ? `${indent}${key}:\n${items.map((i) => `${indent}  - ${i}\n`).join("")}` : "";
const map = (key: string, items: readonly string[], indent = "    ") =>
  items.length > 0 ? `${indent}${key}:\n${items.map((i) => `${indent}  ${i}\n`).join("")}` : "";

/*
 * docker-compose.yml: the database and services, ports on 127.0.0.1 only, plus (with `app`) the app from the
 * dev stage with your source mounted (its own node_modules kept), started once the database is healthy so
 * migrations run. With a local registry the build can reach host.docker.internal.
 */
export function composeFile(
  name: string,
  { app, database, services, localRegistry }: ComposeServices,
): string {
  const specs = serviceSpecs(databaseName(name));
  const chosen = [...(database ? [database] : []), ...services];
  const blocks = chosen.map((service) => {
    const spec = specs[service];
    return (
      `  ${service}:\n    image: ${spec.image}\n` +
      (spec.command ? `    command: ${spec.command}\n` : "") +
      map("healthcheck", spec.healthcheck ?? []) +
      map("environment", spec.environment ?? []) +
      list("ports", spec.ports ?? []) +
      list("volumes", spec.volume ? [spec.volume] : [])
    );
  });
  if (app) {
    blocks.unshift(
      "  app:\n    build:\n      context: .\n      target: dev\n" +
        (localRegistry
          ? list("extra_hosts", ['"host.docker.internal:host-gateway"'], "      ")
          : "") +
        list("ports", ['"127.0.0.1:3000:3000"']) +
        list("volumes", [".:/app", "/app/node_modules"]) +
        map(
          "environment",
          chosen.flatMap((s) => specs[s].env ?? []),
        ) +
        (chosen.length > 0
          ? `    depends_on:\n${chosen
              .map(
                (s) =>
                  `      ${s}:\n        condition: ${specs[s].healthcheck ? "service_healthy" : "service_started"}\n`,
              )
              .join("")}`
          : ""),
    );
  }
  const volumes = chosen.flatMap((s) => specs[s].volume?.split(":")[0] ?? []);
  return (
    "# `npm run docker:up` starts everything below, `npm run docker:down` stops it.\n# Data is kept in named volumes.\n" +
    `services:\n${blocks.join("\n")}` +
    (volumes.length > 0 ? `\nvolumes:\n${volumes.map((v) => `  ${v}:\n`).join("")}` : "")
  );
}

// A concrete URL for a pattern, for tests: `[id]` → `1`, `[...path]` → `a/b`.
function samplePath(pattern: string): string {
  return pattern.replace(/\[\[?\.\.\.\w+\]?\]/g, "a/b").replace(/\[\w+\]/g, "1");
}

// `test/request.ts`: calls routes in-process, shared by every generated test.
export function requestHelperFile(routeTreeImport: string, auth?: AuthKind): string {
  const ext = routeTreeImport.endsWith(".js") ? ".js" : ".ts";
  const adminToken =
    auth === "jwt"
      ? `// The app signs people in with JWTs (src/auth/); the tests sign an admin token
// with the same secret.
process.env.JWT_SECRET ??= "test-secret-for-the-generated-tests-only";
export const ADMIN_TOKEN = await new SignJWT({ role: "admin" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("test-admin")
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.JWT_SECRET));
`
      : auth === "better-auth"
        ? `// Better Auth keeps accounts in memory during tests, not in the database.
vi.mock("#src/auth/database${ext}", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const database = memoryAdapter({ user: [], session: [], account: [], verification: [] });
  return { database, generateId: undefined };
});

// The first admin (src/auth/seed.ts), signed in; its session token works as a Bearer token.
const { auth } = await import("#src/auth/index${ext}");
const { seed } = await import("#src/auth/seed${ext}");
await seed();
const admin = { email: "admin@example.com", password: "12345678" };
export const ADMIN_TOKEN = (await auth.api.signInEmail({ body: admin })).token;
`
        : `export const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_TOKEN = ADMIN_TOKEN;
`;
  const imports =
    auth === "jwt"
      ? 'import { SignJWT } from "jose";\n'
      : auth === "better-auth"
        ? 'import { vi } from "vitest";\n'
        : "";
  return `import {
  createContext,
  createMatcher,
  executeRoute,
  type HttpMethod,
  resolveRoutes,
} from "@sabit/router";
${imports}import { routeTree } from "${routeTreeImport}";

// Calls routes the way the server does (src/middleware.ts, folder middleware and
// schema.ts checks included) without starting it, so the tests work with every
// framework. The tests sign in as an admin with ADMIN_TOKEN.
${adminToken}
const match = createMatcher(await resolveRoutes(routeTree));

export interface TestResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

export async function request(
  method: HttpMethod,
  path: string,
  options: { body?: unknown; token?: string; cookie?: string } = {},
): Promise<TestResponse> {
  const found = match(path.split("?")[0] ?? path);
  if (!found) return { status: 404, body: undefined, headers: new Headers() };
  const headers = new Headers();
  if (options.token) headers.set("authorization", \`Bearer \${options.token}\`);
  if (options.cookie) headers.set("cookie", options.cookie);
  // Browsers send it; auth checks it on cookie requests (CSRF).
  headers.set("origin", "http://localhost:3000");
  const ctx = createContext(found.route, {
    method,
    url: path,
    params: found.params,
    headers,
    body: options.body,
    raw: { framework: "test" },
  });
  const outcome = await executeRoute(found.route, method, ctx);
  const text = outcome.body === null ? "" : await new Response(outcome.body as BodyInit).text();
  return {
    status: outcome.status,
    body: text ? JSON.parse(text) : undefined,
    headers: outcome.headers,
  };
}
`;
}

// `test/memory.ts`: an in-memory repository for tests (the API of src/db/repository.ts).
export const MEMORY_TEST_REPOSITORY = `/** An in-memory repository with the API of src/db/repository.ts, for tests. */
export function memoryRepository<T extends { id: string }>() {
  const rows = new Map<string, T>();
  const matches = (row: T, where: Partial<T>) =>
    Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
  return {
    findAll: async () => [...rows.values()],
    findById: async (id: string) => rows.get(id) ?? null,
    findOne: async (where: Partial<T>) => [...rows.values()].find((row) => matches(row, where)) ?? null,
    async create(data: Omit<T, "id">) {
      const row = { id: crypto.randomUUID(), createdAt: new Date(), ...data } as unknown as T;
      rows.set(row.id, row);
      return row;
    },
    async update(id: string, data: Partial<T>) {
      const row = rows.get(id);
      return row ? Object.assign(row, data) : null;
    },
    delete: async (id: string) => rows.delete(id),
    async deleteMany(where: Partial<T>) {
      let count = 0;
      for (const [id, row] of rows) if (matches(row, where) && rows.delete(id)) count++;
      return count;
    },
  };
}
`;

// `test/routes/auth/flow.test.ts`: sign-up, cookies, sign-out, admin seed; per kind of auth.
export function authFlowTest(ext: string, kind: AuthKind = "jwt"): string {
  if (kind === "better-auth") return betterAuthFlowTest(ext);
  return `import { describe, expect, it, vi } from "vitest";
import { request, type TestResponse } from "#test/request${ext}";

// In-memory repositories instead of the database, so the tests run without one.
vi.mock("#src/db/users.repository.pattern${ext}", async () => {
  const { memoryRepository } = await import("#test/memory${ext}");
  return { userRepository: memoryRepository() };
});
vi.mock("#src/db/refresh-tokens.repository.pattern${ext}", async () => {
  const { memoryRepository } = await import("#test/memory${ext}");
  return { refreshTokenRepository: memoryRepository() };
});

// The cookies a response set, as the Cookie header of the next request.
const cookiesOf = (res: TestResponse) =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

describe("auth", () => {
  it("signs up, reads /auth/me with the cookie, rotates the refresh token", async () => {
    const body = { name: "Ada", email: "ada@example.com", password: "correct horse" };
    const registered = await request("POST", "/auth/register", { body });
    expect(registered.status).toBe(201);
    expect(registered.body).toMatchObject({ user: { email: "ada@example.com", role: "user" } });
    expect(JSON.stringify(registered.body)).not.toContain("passwordHash");
    const cookie = cookiesOf(registered);
    expect(cookie).toContain("access_token=");
    expect(cookie).toContain("refresh_token=");

    expect((await request("GET", "/auth/me", { cookie })).body).toMatchObject({ email: "ada@example.com" });
    expect((await request("GET", "/auth/me")).status).toBe(401);

    const refreshed = await request("POST", "/auth/refresh", { cookie });
    expect(refreshed.status).toBe(200);
    // The old refresh token is spent: using it again ends every session of the account.
    expect((await request("POST", "/auth/refresh", { cookie })).status).toBe(401);
    expect((await request("POST", "/auth/refresh", { cookie: cookiesOf(refreshed) })).status).toBe(401);
  });

  it("refuses wrong passwords and taken emails; logout revokes the session", async () => {
    const body = { name: "Bob", email: "bob@example.com", password: "a good password" };
    expect((await request("POST", "/auth/register", { body })).status).toBe(201);
    expect((await request("POST", "/auth/register", { body })).status).toBe(409);
    const wrong = { email: "bob@example.com", password: "wrong password" };
    expect((await request("POST", "/auth/login", { body: wrong })).status).toBe(401);

    const login = await request("POST", "/auth/login", { body: { email: body.email, password: body.password } });
    expect(login.status).toBe(200);
    expect((await request("POST", "/auth/logout", { cookie: cookiesOf(login) })).status).toBe(204);
    expect((await request("POST", "/auth/refresh", { cookie: cookiesOf(login) })).status).toBe(401);
  });

  it("seeds an admin who can list accounts, which other users cannot do", async () => {
    await import("#src/auth/seed${ext}");
    const password = "12345678";
    const admin = await request("POST", "/auth/login", { body: { email: "admin@example.com", password } });
    expect(admin.status).toBe(200);
    const users = await request("GET", "/users", { cookie: cookiesOf(admin) });
    expect(users.status).toBe(200);
    expect(JSON.stringify(users.body)).not.toContain("passwordHash");

    const bob = await request("POST", "/auth/login", { body: { email: "bob@example.com", password: "a good password" } });
    expect((await request("GET", "/users", { cookie: cookiesOf(bob) })).status).toBe(403);
  });
});
`;
}

function betterAuthFlowTest(ext: string): string {
  return `import { describe, expect, it } from "vitest";
import { request, type TestResponse } from "#test/request${ext}";

// The cookies a response set, as the Cookie header of the next request.
const cookiesOf = (res: TestResponse) =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

const ada = { name: "Ada", email: "ada@example.com", password: "correct horse" };

describe("auth", () => {
  it("signs up, reads the session with the cookie, signs out", async () => {
    const signedUp = await request("POST", "/auth/register", { body: ada });
    expect(signedUp.status).toBe(200);
    expect(signedUp.body).toMatchObject({ user: { email: "ada@example.com", role: "user" } });
    const cookie = cookiesOf(signedUp);
    expect(cookie).toContain("better-auth.session_token=");

    const session = await request("GET", "/auth/me", { cookie });
    expect(session.body).toMatchObject({ user: { email: "ada@example.com" } });
    expect((await request("POST", "/auth/logout", { cookie })).status).toBe(200);
    expect((await request("GET", "/auth/me", { cookie })).status).toBe(401);
  });

  it("refuses a wrong password", async () => {
    const body = { email: "ada@example.com", password: "wrong password" };
    expect((await request("POST", "/auth/login", { body })).status).toBe(401);
  });

  it("seeds an admin who can list accounts, which other users cannot do", async () => {
    await import("#src/auth/seed${ext}");
    const password = "12345678";
    const admin = await request("POST", "/auth/login", { body: { email: "admin@example.com", password } });
    expect(admin.status).toBe(200);
    const users = await request("GET", "/users", { cookie: cookiesOf(admin) });
    expect(users.status).toBe(200);
    expect(JSON.stringify(users.body)).toContain("ada@example.com");

    const signedIn = await request("POST", "/auth/login", { body: { email: ada.email, password: ada.password } });
    expect((await request("GET", "/users", { cookie: cookiesOf(signedIn) })).status).toBe(403);
  });
});
`;
}

/*
 * Where a route's test lives: `helper` is the path to test/request.ts (no extension), `ext` the import
 * extension, `mock` the module the test replaces with an in-memory stand-in.
 */
export interface TestLocation {
  readonly helper: string;
  readonly ext: string;
  readonly mock?: string | undefined;
}

function testHeader({ helper, ext, mock }: TestLocation, imports = "ADMIN_TOKEN, request"): string {
  if (!mock) {
    return `import { describe, expect, it } from "vitest";
import { ${imports} } from "${helper}${ext}";
`;
  }
  return `import { describe, expect, it, vi } from "vitest";
import { ${imports} } from "${helper}${ext}";

// An in-memory userRepository instead of the database, so the tests run without one.
vi.mock("${mock}${ext}", () => {
  const users = new Map<string, { id: string; name: string }>();
  return {
    userRepository: {
      findAll: async () => [...users.values()],
      findById: async (id: string) => users.get(id) ?? null,
      create: async (data: { name: string }) => {
        const user = { id: crypto.randomUUID(), name: data.name };
        users.set(user.id, user);
        return user;
      },
      update: async (id: string, data: { name?: string }) => {
        const user = users.get(id);
        return user ? Object.assign(user, data) : null;
      },
      delete: async (id: string) => users.delete(id),
    },
  };
});
`;
}

// Test for a collection route (`users/api.ts`): list, create, auth.
export function collectionRouteTest(
  pattern: string,
  label: string,
  at: TestLocation,
  auth = true,
): string {
  const path = samplePath(pattern);
  return `${testHeader(at)}
describe("${displayPath(pattern)}", () => {
  it("GET lists ${label}s", async () => {
    const res = await request("GET", "${path}");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST creates a ${label}", async () => {
    const body = { name: "Test ${label}" };
    const res = await request("POST", "${path}", { body, token: ADMIN_TOKEN });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(body);
  });

${
  auth
    ? `
  it("POST needs a signed-in user", async () => {
    const res = await request("POST", "${path}", { body: { name: "Test ${label}" } });
    expect(res.status).toBe(401);
  });
`
    : ""
}});
`;
}

// Test for an item route (`users/[id]/api.ts`): get, replace, change, delete, 404.
export function itemRouteTest(pattern: string, label: string, at: TestLocation): string {
  const collection = samplePath(pattern.slice(0, pattern.lastIndexOf("/")));
  return `${testHeader(at)}
describe("${displayPath(pattern)}", () => {
  // Each test works on a ${label} it creates first.
  async function create() {
    const body = { name: "Test ${label}" };
    const res = await request("POST", "${collection}", { body, token: ADMIN_TOKEN });
    return (res.body as { id: string }).id;
  }

  it("GET returns one ${label}", async () => {
    const id = await create();
    const res = await request("GET", \`${collection}/\${id}\`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, name: "Test ${label}" });
  });

  it("GET answers 404 for an unknown ${label}", async () => {
    const res = await request("GET", "${collection}/unknown-id");
    expect(res.status).toBe(404);
  });

  it("PUT replaces a ${label}", async () => {
    const id = await create();
    const body = { name: "Replaced ${label}" };
    const res = await request("PUT", \`${collection}/\${id}\`, { body, token: ADMIN_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, ...body });
  });

  it("PATCH changes some fields of a ${label}", async () => {
    const id = await create();
    const body = { name: "Changed ${label}" };
    const res = await request("PATCH", \`${collection}/\${id}\`, { body, token: ADMIN_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, ...body });
  });

  it("DELETE removes a ${label}", async () => {
    const id = await create();
    const res = await request("DELETE", \`${collection}/\${id}\`, { token: ADMIN_TOKEN });
    expect(res.status).toBe(204);
    expect((await request("GET", \`${collection}/\${id}\`)).status).toBe(404);
  });
});
`;
}

// Test for a dynamic folder created on its own (`orders/[orderId]/api.ts`).
export function standaloneItemRouteTest(pattern: string, param: string, at: TestLocation): string {
  const path = samplePath(pattern);
  return `${testHeader(at)}
describe("${displayPath(pattern)}", () => {
  it("GET returns the item", async () => {
    const res = await request("GET", "${path}");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ${param}: "1" } });
  });

  it("PATCH changes the item", async () => {
    const res = await request("PATCH", "${path}", { body: { note: "hi" }, token: ADMIN_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { note: "hi", ${param}: "1" } });
  });

  it("DELETE deletes the item", async () => {
    const res = await request("DELETE", "${path}", { token: ADMIN_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ${param}: "1", deleted: true } });
  });
});
`;
}

// Test for a catch-all folder (`files/[...path]/api.ts`).
export function catchAllRouteTest(pattern: string, param: string, at: TestLocation): string {
  return `${testHeader(at, "request")}
describe("${displayPath(pattern)}", () => {
  it("GET receives every segment after the prefix", async () => {
    const res = await request("GET", "${samplePath(pattern)}");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ${param}: ["a", "b"] });
  });
});
`;
}
