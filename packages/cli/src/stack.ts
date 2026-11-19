import { randomBytes } from "node:crypto";
import { type AuthKind, authFiles, betterAuthDatabaseFile } from "./auth-files.ts";
import { envFile, resourceNames } from "./templates.ts";

/*
 * What `sabit init` can add: a database with its ORM, extra services and auth. Each adds dependencies,
 * scripts, .env entries and plain modules that routes import directly, the same in every framework.
 */

export type Database = "postgres" | "mongodb";
export type Orm = "prisma" | "drizzle" | "kysely" | "mongoose" | "typegoose";
export type Extra = "redis" | "bullmq" | "kafka" | "rabbitmq" | "mailpit";

// The ORMs offered for each database, first one is the default.
export const ORMS: Record<Database, readonly Orm[]> = {
  postgres: ["prisma", "drizzle", "kysely"],
  mongodb: ["mongoose", "typegoose", "prisma"],
};

/*
 * The chosen stack: database, ORM, extras, and `auth` (custom JWT in cookies, refresh tokens rotated in
 * the database).
 */
export interface Stack {
  readonly database?: Database | undefined;
  readonly orm?: Orm | undefined;
  readonly extras: readonly Extra[];
  readonly auth?: AuthKind | undefined;
}

/*
 * What a stack adds: files, package.json imports and dependencies, scripts, .env lines, ignored paths,
 * entry imports (queue workers), commands before dev/build, pnpm install-script approvals, and
 * `prismaEngine` (Prisma 6 on MongoDB: images regenerate the client and need OpenSSL).
 */
export interface StackPlan {
  readonly files: Array<[string, string]>;
  readonly imports: Record<string, string>;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly scripts: Record<string, string>;
  readonly env: string[];
  readonly ignore: string[];
  readonly entryImports: string[];
  readonly prepare: string[];
  readonly builds: Record<string, boolean>;
  prismaEngine: boolean;
}

/*
 * The project name (database name, client ids), its import extension (.ts, or .js for NestJS) and whether
 * it's NestJS (compiled to dist/ by tsc, so scripts run the compiled files).
 */
export interface StackContext {
  readonly name: string;
  readonly ext: ".ts" | ".js";
  readonly nest: boolean;
}

// Whether a stack needs anything generated.
export function hasStack(stack: Stack): boolean {
  return stack.orm !== undefined || stack.extras.length > 0 || stack.auth !== undefined;
}

export function planStack(stack: Stack, context: StackContext): StackPlan {
  const plan: StackPlan = {
    files: [],
    imports: {},
    dependencies: {},
    devDependencies: {},
    scripts: {},
    env: [],
    ignore: [],
    entryImports: [],
    prepare: [],
    builds: {},
    prismaEngine: false,
  };
  if (!hasStack(stack)) return plan;
  if (stack.orm) {
    ORM_PLANS[stack.orm](plan, context, stack.database);
    if (stack.auth === "jwt") addAccountFields(plan);
    if (stack.auth === "better-auth") addBetterAuthModels(plan, stack.orm);
    plan.files.push(
      ["src/db/repository.ts", repositoryFile(stack.orm, stack.database, context.ext)],
      [
        `src/db/users${REPOSITORY_PATTERN_SUFFIX}`,
        repositoryPatternFile(
          stack.orm,
          "users",
          { repository: "./repository", models: "./models" },
          context.ext,
        ),
      ],
    );
  }
  for (const extra of stack.extras) EXTRA_PLANS[extra](plan, context);
  if (stack.auth === "jwt") jwtPlan(plan, context, stack.orm);
  if (stack.auth === "better-auth") betterAuthPlan(plan, context, stack.orm, stack.database);
  plan.files.unshift(["src/env.ts", envFile(plan.env.map((line) => line.split("=")[0] as string))]);
  return plan;
}

// Local database name derived from the package name.
export function databaseName(name: string): string {
  return name.replace(/[^a-z0-9_]/g, "_");
}

/*
 * Dependencies, scripts and files per ORM. Prisma's client goes to prisma/generated (#prisma/), or src/ in
 * NestJS, which compiles only src/; its engine install script is allowed, esbuild's (drizzle-kit) skipped;
 * Typegoose pins the Mongoose versions it supports.
 */
const ORM_PLANS: Record<
  Orm,
  (plan: StackPlan, context: StackContext, database: Database | undefined) => void
> = {
  prisma(plan, { name, ext, nest }, database) {
    if (database === "mongodb") {
      prismaMongoPlan(plan, { name, ext });
      return;
    }
    const generated = nest ? "src/generated/prisma" : "prisma/generated";
    const clientImport = nest ? "#src/generated/prisma" : "#prisma/generated";
    if (!nest) plan.imports["#prisma/*"] = "./prisma/*";
    plan.dependencies["@prisma/client"] = "^7.10.1";
    plan.dependencies["@prisma/adapter-pg"] = "^7.10.1";
    plan.devDependencies.prisma = "^7.10.1";
    plan.scripts["db:generate"] = "prisma generate";
    plan.scripts["db:migrate"] = "prisma migrate dev";
    plan.scripts["db:studio"] = "prisma studio";
    plan.env.push(postgresUrl(name));
    plan.ignore.push(`${generated}/`);
    plan.prepare.push("prisma generate");
    plan.builds["@prisma/engines"] = true;
    plan.builds.prisma = true;
    plan.files.push(
      [
        "prisma/schema.prisma",
        `// Your data model. After a change, run \`npm run db:migrate\` to update the database.
// https://www.prisma.io/docs/orm/prisma-schema

// Prisma 7 requires \`output\`; module format and import extensions follow tsconfig.
generator client {
  provider = "prisma-client"
  output   = "${nest ? "../src/generated/prisma" : "./generated"}"
}

datasource db {
  provider = "postgresql"
  // Prisma 7 takes the URL from prisma.config.ts (DATABASE_URL in .env), not from here.
}

model User {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
}
`,
      ],
      [
        "prisma.config.ts",
        `import { ENV } from "./src/env${ext}";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Not needed to generate the client, so a missing DATABASE_URL is fine there.
  datasource: { url: ENV.DATABASE_URL ?? "" },
});
`,
      ],
      [
        "src/db/index.ts",
        `import { ENV } from "#src/env${ext}";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "${clientImport}/client${ext}";

// The client is generated from prisma/schema.prisma (\`npm run db:generate\`).
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: ENV.DATABASE_URL }),
});
`,
      ],
    );
  },

  drizzle(plan, { name, ext }) {
    plan.dependencies["drizzle-orm"] = "^0.45.4";
    plan.dependencies.pg = "^8.23.1";
    plan.devDependencies["drizzle-kit"] = "^0.31.11";
    plan.builds.esbuild = false;
    plan.devDependencies["@types/pg"] = "^8.23.1";
    plan.scripts["db:generate"] = "drizzle-kit generate";
    plan.scripts["db:migrate"] = "drizzle-kit migrate";
    plan.scripts["db:studio"] = "drizzle-kit studio";
    plan.env.push(postgresUrl(name));
    plan.files.push(
      [
        "drizzle.config.ts",
        `import { ENV } from "./src/env${ext}";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: ENV.DATABASE_URL ?? "" },
});
`,
      ],
      [
        "src/db/schema.ts",
        `import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Your tables. After a change, run \`npm run db:generate\` and \`npm run db:migrate\`.
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
`,
      ],
      [
        "src/db/index.ts",
        `import { ENV } from "#src/env${ext}";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema${ext}";

export const db = drizzle(ENV.DATABASE_URL ?? "", { schema });
`,
      ],
    );
  },

  kysely(plan, { name, ext, nest }) {
    plan.dependencies.kysely = "^0.29.9";
    plan.dependencies.pg = "^8.23.1";
    plan.devDependencies["@types/pg"] = "^8.23.1";
    plan.scripts["db:migrate"] = nest
      ? "nest build && node dist/db/migrate.js"
      : "node src/db/migrate.ts";
    plan.env.push(postgresUrl(name));
    plan.files.push(
      [
        "src/db/index.ts",
        `import { ENV } from "#src/env${ext}";
import { type Generated, Kysely, PostgresDialect } from "kysely";
import pg from "pg";

// Your tables, as TypeScript types. Change them together with a migration in
// src/db/migrations, then run \`npm run db:migrate\`.
export interface Database {
  users: {
    id: Generated<string>;
    name: string;
    created_at: Generated<Date>;
  };
}

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: ENV.DATABASE_URL }),
  }),
});
`,
      ],
      [
        "src/db/migrations/0001_create_users.ts",
        `import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>) {
  await db.schema
    .createTable("users")
    .addColumn("id", "text", (col) => col.primaryKey().defaultTo(sql\`gen_random_uuid()::text\`))
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql\`now()\`))
    .execute();
}

export async function down(db: Kysely<unknown>) {
  await db.schema.dropTable("users").execute();
}
`,
      ],
      [
        "src/db/migrate.ts",
        `import { promises as fs } from "node:fs";
import path from "node:path";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { db } from "./index${ext}";

// Applies every migration in ./migrations that hasn't run yet.
const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: path.join(import.meta.dirname, "migrations"),
  }),
});
const { error, results } = await migrator.migrateToLatest();
for (const result of results ?? []) {
  console.log(\`  \${result.status === "Success" ? "applied" : "failed "}  \${result.migrationName}\`);
}
await db.destroy();
if (error) {
  console.error(error);
  process.exitCode = 1;
}
`,
      ],
    );
  },

  mongoose(plan, context) {
    plan.dependencies.mongoose = "^9.12.2";
    mongoPlan(
      plan,
      context,
      `import { type InferSchemaType, model, Schema } from "mongoose";

const userSchema = new Schema(
  { name: { type: String, required: true, trim: true } },
  { timestamps: true },
);

export type UserDocument = InferSchemaType<typeof userSchema>;
export const UserModel = model("User", userSchema);
`,
    );
  },

  typegoose(plan, context) {
    plan.dependencies["@typegoose/typegoose"] = "^13.5.0";
    plan.dependencies.mongoose = "~9.9.5";
    mongoPlan(
      plan,
      context,
      `import { getModelForClass, modelOptions, prop } from "@typegoose/typegoose";

@modelOptions({ schemaOptions: { timestamps: true } })
export class User {
  @prop({ type: String, required: true, trim: true })
  public name!: string;

  // Set by the timestamps option.
  public createdAt?: Date;
}

export const UserModel = getModelForClass(User);
`,
    );
  },
};

// Local MongoDB URL. directConnection: the replica set Docker runs is reachable as localhost.
function mongoUrl(name: string): string {
  return `MONGODB_URI=mongodb://localhost:27017/${databaseName(name)}?directConnection=true`;
}

/*
 * Prisma 7 has no MongoDB driver adapter yet, so MongoDB projects use Prisma 6. `prisma` is a dependency,
 * not a dev dependency: the production image runs `prisma generate`.
 */
function prismaMongoPlan(plan: StackPlan, { name, ext }: Pick<StackContext, "name" | "ext">) {
  plan.dependencies["@prisma/client"] = "^6.19.3";
  plan.dependencies.prisma = "^6.19.3";
  plan.scripts["db:generate"] = "prisma generate";
  plan.scripts["db:push"] = "prisma db push";
  plan.scripts["db:studio"] = "prisma studio";
  plan.env.push(mongoUrl(name));
  plan.prepare.push("prisma generate");
  plan.builds["@prisma/client"] = true;
  plan.builds["@prisma/engines"] = true;
  plan.builds.prisma = true;
  plan.prismaEngine = true;
  plan.files.push(
    [
      "prisma/schema.prisma",
      `// Your data model. MongoDB creates collections on first write; after adding
// indexes (@unique, @@index) run \`npm run db:push\`.
// Prisma needs MongoDB to run as a replica set; docker-compose.dev.yaml starts one.
// https://www.prisma.io/docs/orm/overview/databases/mongodb

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mongodb"
  url      = env("MONGODB_URI")
}

model User {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  name      String
  createdAt DateTime @default(now())
}
`,
    ],
    [
      "src/db/index.ts",
      `import "#src/env${ext}";
import { PrismaClient } from "@prisma/client";

// Connects with MONGODB_URI (see prisma/schema.prisma). The client is generated by
// \`npm run db:generate\`, which \`npm run dev\` and the build run for you.
export const prisma = new PrismaClient();
`,
    ],
  );
}

function mongoPlan(plan: StackPlan, { name, ext }: StackContext, model: string) {
  plan.env.push(mongoUrl(name));
  plan.files.push(
    [
      "src/db/index.ts",
      `import { ENV } from "#src/env${ext}";
import mongoose from "mongoose";

await mongoose.connect(ENV.MONGODB_URI ?? "mongodb://localhost:27017/app");
`,
    ],
    ["src/db/models/user.ts", model],
  );
}

function postgresUrl(name: string): string {
  return `DATABASE_URL=postgres://postgres:postgres@localhost:5432/${databaseName(name)}`;
}

/*
 * Dependencies, .env lines and client modules per extra service. BullMQ's native msgpackr-extract is
 * skipped: it's an optional speed-up.
 */
const EXTRA_PLANS: Record<Extra, (plan: StackPlan, context: StackContext) => void> = {
  redis(plan, { ext }) {
    plan.dependencies.ioredis = "^6.0.0";
    addRedisUrl(plan);
    plan.files.push([
      "src/lib/redis.ts",
      `import { ENV } from "#src/env${ext}";
import { Redis } from "ioredis";

// Connects on first command: await redis.set("key", "value").
export const redis = new Redis(ENV.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
});
`,
    ]);
  },

  bullmq(plan, { ext }) {
    plan.dependencies.bullmq = "^6.7.8";
    plan.dependencies.ioredis = "^6.0.0";
    plan.builds["msgpackr-extract"] = false;
    addRedisUrl(plan);
    plan.entryImports.push("queues/email");
    plan.files.push([
      "src/queues/email.ts",
      `import { ENV } from "#src/env${ext}";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

// BullMQ workers need maxRetriesPerRequest: null on their Redis connection.
const connection = new Redis(ENV.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Add jobs from any route: await emailQueue.add("welcome", { to: "ada@example.com" }).
export const emailQueue = new Queue("email", { connection });

// Processes the jobs in the server process; move it to its own process when they get heavy.
export const emailWorker = new Worker(
  "email",
  async (job) => {
    console.log(\`email job \${job.id}\`, job.data);
  },
  { connection },
);

// Log Redis outages instead of letting them crash the server.
const logError = (error: Error) => console.error(\`email queue: \${error.message || error.name}\`);
emailQueue.on("error", logError);
emailWorker.on("error", logError);
`,
    ]);
  },

  kafka(plan, { name, ext }) {
    plan.dependencies.kafkajs = "^2.2.4";
    plan.env.push("KAFKA_BROKERS=localhost:9092");
    plan.files.push([
      "src/lib/kafka.ts",
      `import { ENV } from "#src/env${ext}";
import { Kafka } from "kafkajs";

export const kafka = new Kafka({
  clientId: "${name}",
  brokers: (ENV.KAFKA_BROKERS ?? "localhost:9092").split(","),
});

// await producer.connect() once, then: await producer.send({ topic: "users", messages: [{ value: "hi" }] }).
export const producer = kafka.producer();
`,
    ]);
  },

  rabbitmq(plan, { ext }) {
    plan.dependencies.amqplib = "^2.4.0";
    plan.env.push("RABBITMQ_URL=amqp://guest:guest@localhost:5672");
    plan.files.push([
      "src/lib/rabbitmq.ts",
      `import { ENV } from "#src/env${ext}";
import amqp from "amqplib";

// Open one connection per process, then channels from it:
// const channel = await (await connectRabbitMQ()).createChannel().
export const connectRabbitMQ = () =>
  amqp.connect(ENV.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672");
`,
    ]);
  },

  mailpit(plan, { ext }) {
    plan.dependencies.nodemailer = "^10.6.0";
    plan.devDependencies["@types/nodemailer"] = "^8.0.2";
    plan.env.push("SMTP_URL=smtp://localhost:1025");
    plan.files.push([
      "src/lib/mailer.ts",
      `import { ENV } from "#src/env${ext}";
import nodemailer from "nodemailer";

// In development Mailpit catches every email; see them at http://localhost:8025.
// await mailer.sendMail({ from: "app@example.com", to: "ada@example.com", subject: "Hi", text: "Hello" }).
export const mailer = nodemailer.createTransport(ENV.SMTP_URL ?? "smtp://localhost:1025");
`,
    ]);
  },
};

function addRedisUrl(plan: StackPlan) {
  const line = "REDIS_URL=redis://localhost:6379";
  if (!plan.env.includes(line)) plan.env.push(line);
}

// `users/api.ts`: reads and writes users through `userRepository`.
export function usersCollectionRoute(ext: string): string {
  return `// Endpoints for /users. Each export named after an HTTP method handles that
// method; what it returns is sent as JSON. Users are stored through
// userRepository (src/db/users.repository.pattern.ts). Bodies are checked
// against ./schema.ts.
import { type RouteContext, reply } from "@sabit/router";
import { type NewUser, userRepository } from "#src/db/users.repository.pattern${ext}";

// GET /users: list users
export const GET = () => userRepository.findAll();

// POST /users: create a user
export const POST = async ({ body }: RouteContext) =>
  reply(201, await userRepository.create(body as NewUser));
`;
}

// `users/[id]/api.ts`: reads and writes one user through `userRepository`.
export function usersItemRoute(ext: string): string {
  return `// Endpoints for /users/:id. params.id is the :id part of the URL.
import { HttpError, type RouteContext } from "@sabit/router";
import { type NewUser, userRepository } from "#src/db/users.repository.pattern${ext}";

type Context = RouteContext<"/users/[id]">;

// GET /users/:id: get one user
export const GET = async ({ params }: Context) =>
  (await userRepository.findById(params.id)) ?? notFound();

// PUT /users/:id: replace a user
export const PUT = async ({ params, body }: Context) =>
  (await userRepository.update(params.id, body as NewUser)) ?? notFound();

// PATCH /users/:id: change some fields of a user
export const PATCH = async ({ params, body }: Context) =>
  (await userRepository.update(params.id, body as Partial<NewUser>)) ?? notFound();

// DELETE /users/:id: delete a user
export const DELETE = async ({ params }: Context) => {
  if (!(await userRepository.delete(params.id))) notFound();
};

function notFound(): never {
  throw new HttpError(404, "User not found");
}
`;
}

// Suffix of files the watcher fills with a repository for one model.
export const REPOSITORY_PATTERN_SUFFIX = ".repository.pattern.ts";

const REPOSITORY_INTERFACE = `/** The operations every repository has, whichever model and database it uses. */
export interface Repository<T, New> {
  findAll(): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  // The first record whose fields equal these values, e.g. { email: "ada@example.com" }.
  findOne(where: Partial<T>): Promise<T | null>;
  create(data: New): Promise<T>;
  // The updated record, or null when there is none with this id.
  update(id: string, data: Partial<New>): Promise<T | null>;
  // Whether a record was deleted.
  delete(id: string): Promise<boolean>;
  // Deletes every record whose fields equal these values; returns how many.
  deleteMany(where: Partial<T>): Promise<number>;
}
`;

const REPOSITORY_HEADER = `// The repository for every model: createRepository(...) gives one model the same
// findAll / findById / create / update / delete. Each *.repository.pattern.ts file
// picks a model with it (create an empty one while \`sabit dev\` runs to get a
// starter), and routes use those repositories instead of the database client.
`;

/*
 * src/db/repository.ts: the one generic repository for the project's ORM (Mongoose and Typegoose share
 * one, since Typegoose models are Mongoose models).
 */
export function repositoryFile(orm: Orm, database: Database | undefined, ext: string): string {
  if (orm === "prisma") {
    const mongo = database === "mongodb";
    return `${REPOSITORY_HEADER}import { prisma } from "./index${ext}";

${REPOSITORY_INTERFACE}
type Client = typeof prisma;

// The models in prisma/schema.prisma, as named on the client: "user", "post", ...
export type ModelName = {
  [K in keyof Client]: Client[K] extends { findMany: unknown } ? K : never;
}[keyof Client] &
  string;

type Delegate = {
  findMany(): Promise<unknown[]>;
  findFirst(args: { where: unknown }): Promise<unknown>;
  findUnique(args: { where: { id: string } }): Promise<unknown>;
  create(args: { data: unknown }): Promise<unknown>;
  updateMany(args: { where: { id: string }; data: unknown }): Promise<{ count: number }>;
  deleteMany(args: { where: unknown }): Promise<{ count: number }>;
};
${mongo ? `\n// Prisma rejects ids that aren't ObjectIds; they can't match a record.\nconst isId = (id: string) => /^[a-f\\d]{24}$/i.test(id);\n` : ""}
// A repository for one Prisma model: createRepository("user").
export function createRepository<M extends ModelName>(model: M) {
  type Row = Awaited<ReturnType<Client[M]["findFirstOrThrow"]>>;
  type New = Parameters<Client[M]["create"]>[0]["data"];
  const delegate = prisma[model] as unknown as Delegate;
  const findById = async (id: string) =>
    ${mongo ? "isId(id) ? delegate.findUnique({ where: { id } }) : null" : "delegate.findUnique({ where: { id } })"};
  const repository = {
    findAll: () => delegate.findMany(),
    findById,
    findOne: (where: Partial<Row>) => delegate.findFirst({ where }),
    deleteMany: async (where: Partial<Row>) => (await delegate.deleteMany({ where })).count,
    create: (data: New) => delegate.create({ data }),
    async update(id: string, data: Partial<New>) {
${mongo ? "      if (!isId(id)) return null;\n" : ""}
      const { count } = await delegate.updateMany({ where: { id }, data });
      return count === 0 ? null : findById(id);
    },
    async delete(id: string) {
${mongo ? "      if (!isId(id)) return false;\n" : ""}
      return (await delegate.deleteMany({ where: { id } })).count > 0;
    },
  };
  // Prisma's per-model types are too generic for TypeScript to check here.
  return repository as unknown as Repository<Row, New>;
}
`;
  }
  if (orm === "drizzle") {
    return `${REPOSITORY_HEADER}import { and, eq, type InferInsertModel, type InferSelectModel, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "./index${ext}";
import * as schema from "./schema${ext}";

${REPOSITORY_INTERFACE}
type Tables = typeof schema;

// The tables in src/db/schema.ts that have an id column: "users", ...
export type TableName = {
  [K in keyof Tables]: Tables[K] extends PgTable & { id: PgColumn } ? K : never;
}[keyof Tables];

// A repository for one Drizzle table: createRepository("users").
export function createRepository<N extends TableName>(name: N) {
  type Row = InferSelectModel<Tables[N]>;
  type New = InferInsertModel<Tables[N]>;
  const table = schema[name] as PgTable & { id: PgColumn };
  const byId = (id: string) => eq(table.id, id);
  const columns = table as unknown as Record<string, PgColumn>;
  const matching = (where: Partial<Row>): SQL | undefined =>
    and(...Object.entries(where).map(([key, value]) => eq(columns[key] as PgColumn, value)));
  const repository: Repository<Row, New> = {
    findAll: async () => (await db.select().from(table)) as Row[],
    async findById(id) {
      const [row] = await db.select().from(table).where(byId(id));
      return (row as Row | undefined) ?? null;
    },
    async findOne(where) {
      const [row] = await db.select().from(table).where(matching(where));
      return (row as Row | undefined) ?? null;
    },
    async create(data) {
      const [row] = await db.insert(table).values(data as never).returning();
      return row as Row;
    },
    async update(id, data) {
      const [row] = await db.update(table).set(data as never).where(byId(id)).returning();
      return (row as Row | undefined) ?? null;
    },
    async delete(id) {
      return (await db.delete(table).where(byId(id)).returning()).length > 0;
    },
    async deleteMany(where) {
      return (await db.delete(table).where(matching(where)).returning()).length;
    },
  };
  return repository;
}
`;
  }
  if (orm === "kysely") {
    return `${REPOSITORY_HEADER}import type { Insertable, Kysely, Selectable } from "kysely";
import { type Database, db } from "./index${ext}";

${REPOSITORY_INTERFACE}
// The tables in src/db/index.ts (the Database interface): "users", ...
export type TableName = keyof Database & string;

// Kysely types every query per table; the generic repository runs them as one
// placeholder table with an id, and types the results per table below.
const anyTable = db as unknown as Kysely<{ table: { id: string } }>;

// A repository for one Kysely table: createRepository("users").
export function createRepository<T extends TableName>(table: T) {
  type Row = Selectable<Database[T]>;
  type New = Insertable<Database[T]>;
  const name = table as unknown as "table";
  const repository: Repository<Row, New> = {
    findAll: async () => (await anyTable.selectFrom(name).selectAll().execute()) as Row[],
    async findById(id) {
      const row = await anyTable.selectFrom(name).selectAll().where("id", "=", id).executeTakeFirst();
      return (row as Row | undefined) ?? null;
    },
    async findOne(where) {
      let query = anyTable.selectFrom(name).selectAll();
      for (const [key, value] of Object.entries(where)) {
        query = query.where(key as "id", "=", value as string);
      }
      return ((await query.executeTakeFirst()) as Row | undefined) ?? null;
    },
    async create(data) {
      return (await anyTable
        .insertInto(name)
        .values(data as never)
        .returningAll()
        .executeTakeFirstOrThrow()) as Row;
    },
    async update(id, data) {
      const row = await anyTable
        .updateTable(name)
        .set(data as never)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      return (row as Row | undefined) ?? null;
    },
    async delete(id) {
      const result = await anyTable.deleteFrom(name).where("id", "=", id).executeTakeFirst();
      return result.numDeletedRows > 0n;
    },
    async deleteMany(where) {
      let query = anyTable.deleteFrom(name);
      for (const [key, value] of Object.entries(where)) {
        query = query.where(key as "id", "=", value as string);
      }
      return Number((await query.executeTakeFirst()).numDeletedRows);
    },
  };
  return repository;
}
`;
  }
  return `${REPOSITORY_HEADER}import { isValidObjectId, type Model } from "mongoose";
import "./index${ext}";

${REPOSITORY_INTERFACE}
// Documents have _id and __v; the API sends id instead.
function toRecord<T>(doc: unknown): T {
  const entries = Object.entries(doc as object).filter(([key]) => key !== "_id" && key !== "__v");
  return { id: String((doc as { _id: unknown })._id), ...Object.fromEntries(entries) } as T;
}

// A repository for one model in src/db/models: createRepository(UserModel).
export function createRepository<Doc>(model: Model<Doc>) {
  type Row = Omit<Doc, "_id" | "__v"> & { id: string };
  type New = Partial<Doc>;
  const repository: Repository<Row, New> = {
    findAll: async () => (await model.find().lean()).map((doc) => toRecord<Row>(doc)),
    async findById(id) {
      const doc = isValidObjectId(id) ? await model.findById(id).lean() : null;
      return doc ? toRecord<Row>(doc) : null;
    },
    async findOne(where) {
      const doc = await model.findOne(where as never).lean();
      return doc ? toRecord<Row>(doc) : null;
    },
    create: async (data) => toRecord<Row>((await model.create(data)).toObject()),
    async update(id, data) {
      if (!isValidObjectId(id)) return null;
      const doc = await model
        .findByIdAndUpdate(id, data, { returnDocument: "after", runValidators: true })
        .lean();
      return doc ? toRecord<Row>(doc) : null;
    },
    async delete(id) {
      return isValidObjectId(id) && (await model.findByIdAndDelete(id)) !== null;
    },
    deleteMany: async (where) => (await model.deleteMany(where as never)).deletedCount,
  };
  return repository;
}
`;
}

/*
 * A `<name>.repository.pattern.ts`: picks the model named after the file (`users` → the `user` model,
 * `users` table or UserModel) and exports its repository and types. Paths are without extension.
 */
export function repositoryPatternFile(
  orm: Orm,
  base: string,
  paths: { repository: string; models: string },
  ext: string,
): string {
  const { entity, data } = resourceNames(base);
  const variable = `${entity[0]?.toLowerCase()}${entity.slice(1)}`;
  const select =
    orm === "prisma"
      ? `createRepository("${variable}")`
      : orm === "drizzle" || orm === "kysely"
        ? `createRepository("${data}")`
        : `createRepository(${entity}Model)`;
  const modelImport =
    orm === "mongoose" || orm === "typegoose"
      ? `import { ${entity}Model } from "${paths.models}/${variable}${ext}";\n`
      : "";
  const what =
    orm === "prisma"
      ? "a model from prisma/schema.prisma"
      : orm === "drizzle"
        ? "a table from src/db/schema.ts"
        : orm === "kysely"
          ? "a table from the Database interface in src/db/index.ts"
          : "a model from src/db/models";
  return `${modelImport}import { createRepository } from "${paths.repository}${ext}";

// The ${entity} repository. Pick ${what} here; your editor lists them.
// Then, e.g. in a route: await ${variable}Repository.findAll(), .findById(id),
// .create(data), .update(id, data), .delete(id).
export const ${variable}Repository = ${select};

export type ${entity} = Awaited<ReturnType<typeof ${variable}Repository.findAll>>[number];
export type New${entity} = Parameters<typeof ${variable}Repository.create>[0];
`;
}

// The ORM a project uses, from its package.json dependencies.
export function detectOrm(dependencies: Record<string, string>): Orm | undefined {
  if (dependencies["@typegoose/typegoose"]) return "typegoose";
  if (dependencies.mongoose) return "mongoose";
  if (dependencies["drizzle-orm"]) return "drizzle";
  if (dependencies.kysely) return "kysely";
  if (dependencies["@prisma/client"]) return "prisma";
  return undefined;
}

/*
 * Adds what an account needs to the users model of whichever ORM generated it:
 * a unique email (the sign-in name), the password hash and a role ("user"
 * by default). Refresh tokens get their own model: see addRefreshTokens.
 */
function addAccountFields(plan: StackPlan): void {
  const edits: Record<string, Array<[string, string]>> = {
    "prisma/schema.prisma": [
      [
        "  name      String\n",
        '  name         String\n  email        String   @unique\n  passwordHash String\n  role         String   @default("user")\n',
      ],
    ],
    "src/db/schema.ts": [
      [
        '  name: text("name").notNull(),\n',
        '  name: text("name").notNull(),\n  email: text("email").notNull().unique(),\n  passwordHash: text("password_hash").notNull(),\n  role: text("role").notNull().default("user"),\n',
      ],
    ],
    "src/db/index.ts": [
      [
        "    name: string;\n    created_at: Generated<Date>;",
        "    name: string;\n    email: string;\n    passwordHash: string;\n    role: Generated<string>;\n    created_at: Generated<Date>;",
      ],
    ],
    "src/db/migrations/0001_create_users.ts": [
      [
        '    .addColumn("name", "text", (col) => col.notNull())\n',
        '    .addColumn("name", "text", (col) => col.notNull())\n    .addColumn("email", "text", (col) => col.notNull().unique())\n    .addColumn("passwordHash", "text", (col) => col.notNull())\n    .addColumn("role", "text", (col) => col.notNull().defaultTo("user"))\n',
      ],
    ],
    "src/db/models/user.ts": [
      [
        "  { name: { type: String, required: true, trim: true } },",
        '  {\n    name: { type: String, required: true, trim: true },\n    email: { type: String, required: true, unique: true, trim: true, lowercase: true },\n    passwordHash: { type: String, required: true },\n    role: { type: String, default: "user" },\n  },',
      ],
      [
        "  public name!: string;\n",
        '  public name!: string;\n\n  @prop({ type: String, required: true, unique: true, trim: true, lowercase: true })\n  public email!: string;\n\n  @prop({ type: String, required: true })\n  public passwordHash!: string;\n\n  @prop({ type: String, default: "user" })\n  public role!: string;\n',
      ],
    ],
  };
  plan.files.forEach((entry, index) => {
    let content = entry[1];
    for (const [from, to] of edits[entry[0]] ?? []) content = content.replace(from, to);
    plan.files[index] = [entry[0], content];
  });
}

/*
 * Custom JWT: accounts in the users repository (in memory without a database), cookie sessions with
 * rotated refresh tokens, and a seed that creates the first admin on the first start outside production.
 */
function jwtPlan(plan: StackPlan, { ext }: StackContext, orm: Orm | undefined): void {
  addRefreshTokens(plan, orm, ext);
  plan.dependencies.jose = "^6.2.17";
  plan.env.push(`JWT_SECRET=${randomBytes(48).toString("base64url")}`);
  plan.entryImports.push("auth/seed");
  if (!orm) {
    plan.files.push(
      ["src/db/repository.ts", MEMORY_REPOSITORY],
      [`src/db/users${REPOSITORY_PATTERN_SUFFIX}`, memoryUsersPattern(ext)],
      [`src/db/refresh-tokens${REPOSITORY_PATTERN_SUFFIX}`, MEMORY_REFRESH_TOKENS(ext)],
    );
  }
  plan.files.push(...authFiles("jwt", ext));
}

/*
 * Better Auth: accounts and sessions in the project's database (its ORM's adapter), the admin seed,
 * and every endpoint under /auth through one catch-all route.
 */
function betterAuthPlan(
  plan: StackPlan,
  { ext }: StackContext,
  orm: Orm | undefined,
  database: Database | undefined,
): void {
  if (!orm) throw new Error("Better Auth needs a database");
  plan.dependencies["better-auth"] = "^1.7.25";
  if (orm === "kysely") plan.dependencies["@better-auth/kysely-adapter"] = "^1.7.25";
  plan.env.push(
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`,
    "BETTER_AUTH_URL=http://localhost:3000",
  );
  plan.entryImports.push("auth/seed");
  plan.files.push(
    ["src/auth/database.ts", betterAuthDatabaseFile(orm, database === "mongodb", ext)],
    ...authFiles("better-auth", ext),
  );
}

const MEMORY_REPOSITORY = `// The repository for every model, kept in memory: this project has no database
// yet, so data is lost on restart. createRepository<User>() gives a model the same
// findAll / findById / findOne / create / update / delete a database would.

${REPOSITORY_INTERFACE}
export function createRepository<T extends { id: string }, New = Omit<T, "id" | "createdAt">>() {
  const rows = new Map<string, T>();
  const repository: Repository<T, New> = {
    findAll: async () => [...rows.values()],
    findById: async (id) => rows.get(id) ?? null,
    async findOne(where) {
      const matches = (row: T) =>
        Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
      return [...rows.values()].find(matches) ?? null;
    },
    async create(data) {
      const row = { id: crypto.randomUUID(), createdAt: new Date(), ...data } as unknown as T;
      rows.set(row.id, row);
      return row;
    },
    async update(id, data) {
      const row = rows.get(id);
      return row ? Object.assign(row, data) : null;
    },
    delete: async (id) => rows.delete(id),
    async deleteMany(where) {
      let count = 0;
      for (const [id, row] of rows) {
        const matches = Object.entries(where).every(
          ([key, value]) => (row as Record<string, unknown>)[key] === value,
        );
        if (matches && rows.delete(id)) count++;
      }
      return count;
    },
  };
  return repository;
}
`;

const MEMORY_REFRESH_TOKENS = (
  ext: string,
) => `import { createRepository } from "./repository${ext}";

export interface RefreshToken {
  id: string;
  userId: string;
  // SHA-256 of the token: the token itself is never stored.
  tokenHash: string;
  expiresAt: Date;
  // Set when the token was used (rotated) or the session logged out.
  revokedAt?: Date | null;
  createdAt: Date;
}

export type NewRefreshToken = Omit<RefreshToken, "id" | "createdAt">;

export const refreshTokenRepository = createRepository<RefreshToken, NewRefreshToken>();
`;

/*
 * Where refresh tokens are kept, per ORM: a RefreshToken model (SHA-256 of the
 * token, its user, expiry, revocation) and its repository. Rotation and reuse
 * detection in src/auth.ts work the same on PostgreSQL, MongoDB and in memory.
 */
function addRefreshTokens(plan: StackPlan, orm: Orm | undefined, ext: string): void {
  if (!orm) return;
  const edit = (file: string, change: (content: string) => string) => {
    plan.files.forEach((entry, index) => {
      if (entry[0] === file) plan.files[index] = [file, change(entry[1])];
    });
  };
  if (orm === "prisma") {
    edit("prisma/schema.prisma", (content) => {
      const id = content.includes('provider = "mongodb"')
        ? 'String    @id @default(auto()) @map("_id") @db.ObjectId'
        : "String    @id @default(uuid())";
      return `${content}
model RefreshToken {
  id        ${id}
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
}
`;
    });
  } else if (orm === "drizzle") {
    edit(
      "src/db/schema.ts",
      (content) => `${content}
// Refresh tokens: only their SHA-256 is stored. Rotated on every refresh.
export const refreshTokens = pgTable("refresh_tokens", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
`,
    );
  } else if (orm === "kysely") {
    edit("src/db/index.ts", (content) =>
      content.replace(
        "    created_at: Generated<Date>;\n  };\n}",
        "    created_at: Generated<Date>;\n  };\n  refreshTokens: {\n    id: Generated<string>;\n    userId: string;\n    tokenHash: string;\n    expiresAt: Date;\n    revokedAt: Date | null;\n    created_at: Generated<Date>;\n  };\n}",
      ),
    );
    plan.files.push([
      "src/db/migrations/0002_create_refresh_tokens.ts",
      `import { type Kysely, sql } from "kysely";

// Refresh tokens: only their SHA-256 is stored. Rotated on every refresh.
export async function up(db: Kysely<unknown>) {
  await db.schema
    .createTable("refreshTokens")
    .addColumn("id", "text", (col) => col.primaryKey().defaultTo(sql\`gen_random_uuid()::text\`))
    .addColumn("userId", "text", (col) => col.notNull())
    .addColumn("tokenHash", "text", (col) => col.notNull().unique())
    .addColumn("expiresAt", "timestamptz", (col) => col.notNull())
    .addColumn("revokedAt", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql\`now()\`))
    .execute();
  await db.schema.createIndex("refresh_tokens_user_id").on("refreshTokens").column("userId").execute();
}

export async function down(db: Kysely<unknown>) {
  await db.schema.dropTable("refreshTokens").execute();
}
`,
    ]);
  } else if (orm === "mongoose") {
    plan.files.push([
      "src/db/models/refreshToken.ts",
      `import { model, Schema } from "mongoose";

// Refresh tokens: only their SHA-256 is stored. Rotated on every refresh; MongoDB
// deletes expired ones by itself (the TTL index on expiresAt).
const refreshTokenSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    revokedAt: { type: Date },
  },
  { timestamps: true },
);

export const RefreshTokenModel = model("RefreshToken", refreshTokenSchema);
`,
    ]);
  } else if (orm === "typegoose") {
    plan.files.push([
      "src/db/models/refreshToken.ts",
      `import { getModelForClass, modelOptions, prop } from "@typegoose/typegoose";

// Refresh tokens: only their SHA-256 is stored. Rotated on every refresh; MongoDB
// deletes expired ones by itself (the TTL index on expiresAt).
@modelOptions({ schemaOptions: { timestamps: true } })
export class RefreshToken {
  @prop({ type: String, required: true, index: true })
  public userId!: string;

  @prop({ type: String, required: true, unique: true })
  public tokenHash!: string;

  @prop({ type: Date, required: true, expires: 0 })
  public expiresAt!: Date;

  @prop({ type: Date })
  public revokedAt?: Date;
}

export const RefreshTokenModel = getModelForClass(RefreshToken);
`,
    ]);
  }
  plan.files.push([
    `src/db/refresh-tokens${REPOSITORY_PATTERN_SUFFIX}`,
    repositoryPatternFile(
      orm,
      "refresh-tokens",
      { repository: "./repository", models: "./models" },
      ext,
    ),
  ]);
}

function memoryUsersPattern(ext: string): string {
  return `import { createRepository } from "./repository${ext}";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
}

export type NewUser = Omit<User, "id" | "createdAt">;

// The User repository, in memory. Switch to a database later and only this file changes.
export const userRepository = createRepository<User, NewUser>();
`;
}

/*
 * Turns the users model into Better Auth's (email, role, ban fields, createdAt, updatedAt)
 * and adds its sessions, accounts and verifications, per ORM.
 */
function addBetterAuthModels(plan: StackPlan, orm: Orm): void {
  const edit = (file: string, change: (content: string) => string) => {
    plan.files.forEach((entry, index) => {
      if (entry[0] === file) plan.files[index] = [file, change(entry[1])];
    });
  };
  if (orm === "prisma") {
    edit("prisma/schema.prisma", (content) => {
      const mongo = content.includes('provider = "mongodb"');
      const id = mongo
        ? 'String    @id @default(auto()) @map("_id") @db.ObjectId'
        : "String    @id @default(uuid())";
      const ref = mongo ? "String    @db.ObjectId" : "String";
      const model = content.slice(content.indexOf("model User {"));
      return content.replace(
        model,
        `// Accounts, sessions and sign-in records, managed by Better Auth (src/auth/).
model User {
  id              ${id}
  name            String
  email           String    @unique
  emailVerified   Boolean   @default(false)
  image           String?
  role            String?   @default("user")
  banned          Boolean?  @default(false)
  banReason       String?
  banExpires      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @default(now()) @updatedAt
  sessions        Session[]
  accounts        Account[]
}

model Session {
  id             ${id}
  token          String    @unique
  expiresAt      DateTime
  ipAddress      String?
  userAgent      String?
  impersonatedBy String?
  userId         ${ref}
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([userId])
}

model Account {
  id                    ${id}
  accountId             String
  providerId            String
  userId                ${ref}
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([userId])
}

model Verification {
  id         ${id}
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
}
`,
      );
    });
  } else if (orm === "drizzle") {
    edit("src/db/schema.ts", (content) => {
      const users = content.slice(content.indexOf("export const users"));
      return content
        .replace(
          'import { pgTable, text, timestamp } from "drizzle-orm/pg-core";',
          'import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";',
        )
        .replace(
          users,
          `const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const timestamps = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Accounts, sessions and sign-in records, managed by Better Auth (src/auth/).
export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [index("sessions_user_id").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [index("accounts_user_id").on(table.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    ...timestamps,
  },
  (table) => [index("verifications_identifier").on(table.identifier)],
);
`,
        );
    });
  } else if (orm === "kysely") {
    edit("src/db/index.ts", (content) =>
      content.replace(
        "    name: string;\n    created_at: Generated<Date>;\n  };\n}",
        `    name: string;
    email: string;
    emailVerified: Generated<boolean>;
    image: string | null;
    role: Generated<string | null>;
    banned: Generated<boolean | null>;
    banReason: string | null;
    banExpires: Date | null;
    createdAt: Generated<Date>;
    updatedAt: Generated<Date>;
  };
  // Managed by Better Auth (src/auth/), like the account fields above.
  sessions: {
    id: string;
    token: string;
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    impersonatedBy: string | null;
    userId: string;
    createdAt: Generated<Date>;
    updatedAt: Generated<Date>;
  };
  accounts: {
    id: string;
    accountId: string;
    providerId: string;
    userId: string;
    accessToken: string | null;
    refreshToken: string | null;
    idToken: string | null;
    accessTokenExpiresAt: Date | null;
    refreshTokenExpiresAt: Date | null;
    scope: string | null;
    password: string | null;
    createdAt: Generated<Date>;
    updatedAt: Generated<Date>;
  };
  verifications: {
    id: string;
    identifier: string;
    value: string;
    expiresAt: Date;
    createdAt: Generated<Date>;
    updatedAt: Generated<Date>;
  };
}`,
      ),
    );
    plan.files.push(["src/db/migrations/0002_better_auth.ts", KYSELY_BETTER_AUTH_MIGRATION]);
  } else {
    edit("src/db/models/user.ts", (content) =>
      orm === "mongoose"
        ? content.replace(
            "  { name: { type: String, required: true, trim: true } },",
            `  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    image: { type: String },
    role: { type: String, default: "user" },
    banned: { type: Boolean, default: false },
    banReason: { type: String },
    banExpires: { type: Date },
  },`,
          )
        : content.replace(
            "  public name!: string;\n",
            `  public name!: string;

  @prop({ type: String, required: true, unique: true, lowercase: true, trim: true })
  public email!: string;

  @prop({ type: Boolean, default: false })
  public emailVerified!: boolean;

  @prop({ type: String })
  public image?: string;

  @prop({ type: String, default: "user" })
  public role?: string;

  @prop({ type: Boolean, default: false })
  public banned?: boolean;

  @prop({ type: String })
  public banReason?: string;

  @prop({ type: Date })
  public banExpires?: Date;
`,
          ),
    );
  }
}

// Better Auth's columns on users (created_at becomes createdAt) and its other tables, for Kysely.
const KYSELY_BETTER_AUTH_MIGRATION = `import { type ColumnDefinitionBuilder, type Kysely, sql } from "kysely";

// The user a row belongs to; deleting the user deletes the row.
const user = (col: ColumnDefinitionBuilder) => col.notNull().references("users.id").onDelete("cascade");

export async function up(db: Kysely<unknown>) {
  await db.schema.alterTable("users").renameColumn("created_at", "createdAt").execute();
  await db.schema
    .alterTable("users")
    .addColumn("email", "text", (col) => col.unique())
    .addColumn("emailVerified", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("image", "text")
    .addColumn("role", "text", (col) => col.defaultTo("user"))
    .addColumn("banned", "boolean", (col) => col.defaultTo(false))
    .addColumn("banReason", "text")
    .addColumn("banExpires", "timestamptz")
    .addColumn("updatedAt", "timestamptz", (col) => col.notNull().defaultTo(sql\`now()\`))
    .execute();
  await db.schema
    .createTable("sessions")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("token", "text", (col) => col.notNull().unique())
    .addColumn("expiresAt", "timestamptz", (col) => col.notNull())
    .addColumn("ipAddress", "text")
    .addColumn("userAgent", "text")
    .addColumn("impersonatedBy", "text")
    .addColumn("userId", "text", user)
    .addColumn("createdAt", "timestamptz", (col) => col.notNull().defaultTo(sql\`now()\`))
    .addColumn("updatedAt", "timestamptz", (col) => col.notNull().defaultTo(sql\`now()\`))
    .execute();
  await db.schema
    .createTable("accounts")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("accountId", "text", (col) => col.notNull())
    .addColumn("providerId", "text", (col) => col.notNull())
    .addColumn("userId", "text", user)
    .addColumn("accessToken", "text")
    .addColumn("refreshToken", "text")
    .addColumn("idToken", "text")
    .addColumn("accessTokenExpiresAt", "timestamptz")
    .addColumn("refreshTokenExpiresAt", "timestamptz")
    .addColumn("scope", "text")
    .addColumn("password", "text")
    .addColumn("createdAt", "timestamptz", (col) => col.notNull().defaultTo(sql\`now()\`))
    .addColumn("updatedAt", "timestamptz", (col) => col.notNull().defaultTo(sql\`now()\`))
    .execute();
  await db.schema
    .createTable("verifications")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("identifier", "text", (col) => col.notNull())
    .addColumn("value", "text", (col) => col.notNull())
    .addColumn("expiresAt", "timestamptz", (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.notNull().defaultTo(sql\`now()\`))
    .addColumn("updatedAt", "timestamptz", (col) => col.notNull().defaultTo(sql\`now()\`))
    .execute();
  await db.schema.createIndex("sessions_user_id").on("sessions").column("userId").execute();
  await db.schema.createIndex("accounts_user_id").on("accounts").column("userId").execute();
}

export async function down(db: Kysely<unknown>) {
  for (const table of ["verifications", "accounts", "sessions"]) {
    await db.schema.dropTable(table).execute();
  }
}
`;
