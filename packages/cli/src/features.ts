import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import * as prompts from "@clack/prompts";
import {
  ACCOUNTS_SCHEMA,
  AUTH_ACCESS,
  type AuthKind,
  adminHint,
  authPlaceholderFile,
  LEGACY_AUTH_FILES,
  OLD_AUTH_ROUTES,
} from "./auth-files.ts";
import type { Output } from "./command.ts";
import { FRAMEWORKS, type Framework } from "./frameworks.ts";
import { execBin, type PackageManager, runScript } from "./project.ts";
import {
  addAccessRules,
  detectAlias,
  detectImportExtension,
  detectQuoteStyle,
  planScaffold,
  replaceAccessRule,
  testLocation,
} from "./scaffold.ts";
import {
  type Database,
  detectOrm,
  type Extra,
  ORMS,
  type Orm,
  planStack,
  usersCollectionRoute,
  usersItemRoute,
} from "./stack.ts";
import {
  authFlowTest,
  collectionRouteTest,
  composeFile,
  dockerfile,
  dockerignoreFile,
  itemRouteTest,
  MEMORY_TEST_REPOSITORY,
  OLD_DOCS_FILES,
  requestHelperFile,
  type Service,
} from "./templates.ts";

export interface DockerChoice {
  readonly dockerfile: boolean;
  readonly compose: boolean;
  readonly app: boolean;
}

// What a project has: a database and its ORM, extra services, authentication and Docker.
export interface Features {
  readonly database?: Database | undefined;
  readonly orm?: Orm | undefined;
  readonly extras: readonly Extra[];
  readonly auth?: AuthKind | undefined;
  readonly docker?: DockerChoice | undefined;
}

/*
 * The project sabit works in: its folder, package name, framework, package manager and code style
 * (import extension, quotes, #src/ aliases), and how dependencies are installed.
 */
export interface Project {
  readonly dir: string;
  readonly name: string;
  readonly framework: Framework;
  readonly pm: PackageManager;
  readonly ext: ".ts" | ".js";
  readonly single: boolean;
  readonly alias: boolean;
  readonly repo: boolean;
  readonly localRegistry: boolean;
}

// sabit.json: the features installed and a fingerprint of every file sabit wrote.
interface State {
  features: Features;
  files: Record<string, string>;
}

const EXTRAS: ReadonlyArray<{ value: Extra; label: string; hint: string }> = [
  { value: "redis", label: "Redis", hint: "cache and sessions (ioredis)" },
  { value: "bullmq", label: "BullMQ", hint: "background jobs on Redis" },
  { value: "kafka", label: "Kafka", hint: "event streaming (kafkajs)" },
  { value: "rabbitmq", label: "RabbitMQ", hint: "message broker (amqplib)" },
  { value: "mailpit", label: "Email", hint: "nodemailer; Mailpit catches mail in development" },
];

const ORM_LABELS: Record<Orm, { label: string; hint: string }> = {
  prisma: { label: "Prisma", hint: "schema file, generated client and migrations" },
  drizzle: { label: "Drizzle", hint: "tables in TypeScript, SQL-like queries" },
  kysely: { label: "Kysely", hint: "typed SQL query builder, hand-written migrations" },
  mongoose: { label: "Mongoose", hint: "schemas and models" },
  typegoose: { label: "Typegoose", hint: "Mongoose models as decorated classes" },
};

const sha = (content: string) => createHash("sha256").update(content).digest("hex");

export function readState(dir: string): State | undefined {
  const file = join(dir, "sabit.json");
  if (!existsSync(file)) return undefined;
  const state = JSON.parse(readFileSync(file, "utf8")) as Partial<State>;
  return { features: state.features ?? { extras: [] }, files: state.files ?? {} };
}

/*
 * The features of a project without sabit.json (made before it existed), read from its
 * dependencies and files.
 */
export function detectFeatures(dir: string): Features {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const deps = pkg.dependencies ?? {};
  const orm = detectOrm(deps);
  const schema = join(dir, "prisma/schema.prisma");
  const mongo =
    orm === "mongoose" ||
    orm === "typegoose" ||
    (orm === "prisma" && existsSync(schema) && readFileSync(schema, "utf8").includes('"mongodb"'));
  const extras = (
    [
      ["ioredis", "redis"],
      ["bullmq", "bullmq"],
      ["kafkajs", "kafka"],
      ["amqplib", "rabbitmq"],
      ["nodemailer", "mailpit"],
    ] as const
  ).flatMap(([dep, extra]) => (deps[dep] ? [extra] : []));
  const legacy = join(dir, "src/auth.ts");
  const jwt =
    existsSync(join(dir, "src/auth/utils/jwt.ts")) ||
    (existsSync(legacy) && readFileSync(legacy, "utf8").includes('"jose"'));
  const docker = existsSync(join(dir, "Dockerfile")) || existsSync(join(dir, "docker-compose.yml"));
  return {
    database: orm ? (mongo ? "mongodb" : "postgres") : undefined,
    orm,
    extras: extras.filter((e) => e !== "redis" || !extras.includes("bullmq")),
    auth: deps["better-auth"] ? "better-auth" : jwt ? "jwt" : undefined,
    docker: docker
      ? {
          dockerfile: existsSync(join(dir, "Dockerfile")),
          compose: existsSync(join(dir, "docker-compose.yml")),
          app: existsSync(join(dir, "docker-compose.yml")),
        }
      : undefined,
  };
}

const PACKAGE_MANAGERS: readonly PackageManager[] = ["pnpm", "yarn", "bun", "npm"];

// The sabit project in `dir`: undefined when there's no package.json with a @sabit adapter.
export function detectProject(dir: string): Project | undefined {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return undefined;
  const pkg = JSON.parse(readFileSync(file, "utf8")) as {
    name?: string;
    packageManager?: string;
    dependencies?: Record<string, string>;
  };
  const framework = FRAMEWORKS.find((f) => pkg.dependencies?.[`@sabit/${f.id}`]);
  if (!framework) return undefined;
  const lockfiles: Array<[string, PackageManager]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["pnpm-workspace.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
  ];
  const pm =
    lockfiles.find(([lock]) => existsSync(join(dir, lock)))?.[1] ??
    PACKAGE_MANAGERS.find((m) => pkg.packageManager?.startsWith(`${m}@`)) ??
    PACKAGE_MANAGERS.find((m) => process.env.npm_config_user_agent?.startsWith(`${m}/`)) ??
    "npm";
  const npmrc = join(dir, ".npmrc");
  const registry = existsSync(npmrc) ? readFileSync(npmrc, "utf8") : "";
  return {
    dir,
    name: pkg.name ?? "app",
    framework,
    pm,
    ext: detectImportExtension(dir),
    single: detectQuoteStyle(dir) === "single",
    alias: detectAlias(dir),
    repo: Object.values(pkg.dependencies ?? {}).some((v) => v.startsWith("workspace:")),
    localRegistry: /\/\/(localhost|127\.0\.0\.1)[:/]/.test(registry),
  };
}

/*
 * Database, ORM, extras and auth from --db, --orm, --with and --auth. Undefined (after an error) on
 * invalid flags; Typegoose is NestJS only, since the other starters can't run decorators.
 */
function featuresFromFlags(
  flags: Readonly<Record<string, string | boolean | undefined>>,
  installed: Features,
  framework: Framework,
  out: Output,
): Features | undefined {
  const dbFlag = flags.db as string | undefined;
  if (dbFlag && !["postgres", "mongodb", "none"].includes(dbFlag)) {
    out.error(`Unknown --db "${dbFlag}". Choose: postgres, mongodb, none`);
    return undefined;
  }
  const database = installed.database ?? (dbFlag === "none" ? undefined : (dbFlag as Database));
  const ormFlag = flags.orm as string | undefined;
  if (ormFlag && !(database && ORMS[database].includes(ormFlag as Orm))) {
    const choices = database ? ORMS[database].join(", ") : "none without --db";
    out.error(`Unknown --orm "${ormFlag}" for this database. Choose: ${choices}`);
    return undefined;
  }
  const orm = installed.orm ?? (database ? ((ormFlag as Orm) ?? ORMS[database][0]) : undefined);
  if (orm === "typegoose" && framework.id !== "nest") {
    out.error(
      "Typegoose needs decorators, which only the NestJS starter compiles. Use --orm mongoose.",
    );
    return undefined;
  }
  const extras = ((flags.with as string | undefined) ?? "").split(",").filter(Boolean) as Extra[];
  const unknown = extras.find((extra) => !EXTRAS.some((e) => e.value === extra));
  if (unknown) {
    out.error(`Unknown --with "${unknown}". Choose: ${EXTRAS.map((e) => e.value).join(", ")}`);
    return undefined;
  }
  const authFlag = flags.auth as string | undefined;
  if (authFlag && !["jwt", "better-auth", "none"].includes(authFlag)) {
    out.error(`Unknown --auth "${authFlag}". Choose: jwt, better-auth, none`);
    return undefined;
  }
  const auth = installed.auth ?? (authFlag === "none" ? undefined : (authFlag as AuthKind));
  if (auth === "better-auth" && !database) {
    out.error("Better Auth keeps accounts in a database: add --db postgres or --db mongodb.");
    return undefined;
  }
  return {
    ...installed,
    database,
    orm,
    extras: [...new Set([...installed.extras, ...extras])],
    auth,
  };
}

/*
 * Asks what to add, offering only what isn't installed (Docker stays, to regenerate it). `gate`
 * first asks whether to add anything now (sabit init); `preselected` skips the menu (sabit setup auth).
 * Returns the features the project should have, or undefined when cancelled or on bad flags.
 */
export async function askFeatures(options: {
  installed: Features;
  framework: Framework;
  flags: Readonly<Record<string, string | boolean | undefined>>;
  ask: boolean;
  gate: boolean;
  preselected?: readonly string[];
  out: Output;
  cancelled: (value: unknown) => value is symbol;
}): Promise<Features | undefined> {
  const { installed, framework, flags, ask, out, cancelled } = options;
  const fromFlags = featuresFromFlags(flags, installed, framework, out);
  if (!fromFlags) return undefined;
  const flagged = ["db", "orm", "with", "auth"].some((f) => flags[f] !== undefined);
  if (!ask || (flagged && !options.preselected?.length)) return fromFlags;

  let picked = [...(options.preselected ?? [])];
  if (picked.length === 0) {
    if (options.gate) {
      const now = await prompts.confirm({
        message: "Add a database, auth, Redis, queues, email or Docker now?",
        initialValue: false,
      });
      if (cancelled(now)) return undefined;
      if (!now) return fromFlags;
    }
    const choices = [
      ...(installed.database
        ? []
        : [{ value: "database", label: "Database", hint: "PostgreSQL or MongoDB, with an ORM" }]),
      ...(installed.auth
        ? []
        : [{ value: "auth", label: "Authentication", hint: "sign-up, login, sessions" }]),
      ...EXTRAS.filter((e) => !installed.extras.includes(e.value)),
      {
        value: "docker",
        label: "Docker",
        hint: installed.docker
          ? "regenerate for what's installed"
          : "Dockerfile + docker-compose.yml",
      },
    ];
    const answer = await prompts.multiselect<string>({
      message: "What do you want to set up? (space to select, enter to continue)",
      options: choices,
      required: false,
    });
    if (cancelled(answer)) return undefined;
    picked = answer;
  }
  if (picked.length === 0) return fromFlags;

  let { database, orm } = fromFlags;
  const askDatabase = async (message: string): Promise<boolean> => {
    const db = await prompts.select<Database>({
      message,
      options: [
        { value: "postgres", label: "PostgreSQL" },
        { value: "mongodb", label: "MongoDB" },
      ],
      initialValue: "postgres",
    });
    if (cancelled(db)) return false;
    database = db;
    const choice = await prompts.select<Orm>({
      message: "Which ORM?",
      options: ORMS[db].map((value) => {
        const nestOnly = value === "typegoose" && framework.id !== "nest";
        return {
          value,
          label: ORM_LABELS[value].label,
          hint: nestOnly
            ? "NestJS only: needs decorators"
            : value === "prisma" && db === "mongodb"
              ? "Prisma 6: Prisma 7 can't connect to MongoDB yet"
              : ORM_LABELS[value].hint,
          disabled: nestOnly,
        };
      }),
      initialValue: ORMS[db][0] as Orm,
    });
    if (cancelled(choice)) return false;
    orm = choice;
    return true;
  };
  if (picked.includes("database") && !database && !(await askDatabase("Which database?"))) {
    return undefined;
  }
  let auth = fromFlags.auth;
  if (picked.includes("auth") && !auth) {
    const answer = await prompts.select<AuthKind>({
      message: "Which authentication?",
      options: [
        {
          value: "jwt",
          label: "Custom JWT",
          hint: "tokens in HttpOnly cookies, refresh tokens rotated in the database",
        },
        {
          value: "better-auth",
          label: "Better Auth",
          hint: "email sign-in, database sessions, admin roles; needs a database",
        },
      ],
      initialValue: "jwt",
    });
    if (cancelled(answer)) return undefined;
    auth = answer;
    if (auth === "better-auth" && !database) {
      const asked = await askDatabase("Better Auth keeps accounts in a database. Which database?");
      if (!asked) return undefined;
    }
  }
  let docker = fromFlags.docker;
  if (picked.includes("docker")) {
    const answer = await askDocker(cancelled);
    if (!answer) return undefined;
    docker = answer;
  }
  const extras = [
    ...new Set([...fromFlags.extras, ...picked.filter((p) => EXTRAS.some((e) => e.value === p))]),
  ] as Extra[];
  return { database, orm, extras, auth, docker };
}

// The Docker questions; each follow-up only when it applies. Undefined when cancelled.
async function askDocker(
  cancelled: (value: unknown) => value is symbol,
): Promise<DockerChoice | undefined> {
  const dockerfileWanted = await prompts.confirm({
    message: "Add a Dockerfile (a dev stage for docker-compose, a lean production stage)?",
    initialValue: true,
  });
  if (cancelled(dockerfileWanted)) return undefined;
  const compose = await prompts.confirm({
    message: "Add docker-compose.yml for the database and services?",
    initialValue: true,
  });
  if (cancelled(compose)) return undefined;
  if (!compose || !dockerfileWanted) return { dockerfile: dockerfileWanted, compose, app: false };
  const app = await prompts.confirm({
    message: "Run the app in docker-compose.yml too, reloading on save?",
    initialValue: true,
  });
  if (cancelled(app)) return undefined;
  return { dockerfile: dockerfileWanted, compose, app };
}

/*
 * Writes files without overwriting your changes: a file is written when it's missing or still exactly
 * what sabit last wrote (its fingerprint in sabit.json); otherwise sabit's version goes next to it.
 */
class Writer {
  readonly dir: string;
  readonly state: State;
  readonly out: Output;

  constructor(dir: string, state: State, out: Output) {
    this.dir = dir;
    this.state = state;
    this.out = out;
  }

  async write(file: string, content: string): Promise<void> {
    const target = join(this.dir, file);
    if (existsSync(target)) {
      const current = await readFile(target, "utf8");
      if (current === content) {
        this.state.files[file] = sha(content);
        return;
      }
      if (this.state.files[file] !== sha(current)) {
        await writeFile(`${target}.sabit-new`, content);
        this.out.log(`  kept     ${file} (you changed it); sabit's version: ${file}.sabit-new`);
        return;
      }
      await writeFile(target, content);
      this.state.files[file] = sha(content);
      this.out.log(`  updated  ${file}`);
      return;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    this.state.files[file] = sha(content);
    this.out.log(`  created  ${file}`);
  }

  async remove(file: string): Promise<void> {
    const target = join(this.dir, file);
    if (!existsSync(target)) return;
    if (this.state.files[file] !== sha(await readFile(target, "utf8"))) {
      this.out.log(`  kept     ${file} (you changed it); it no longer fits, remove it if unused`);
      return;
    }
    await rm(target);
    delete this.state.files[file];
    this.out.log(`  removed  ${file}`);
  }
}

// Containers docker-compose.yml runs for the extras (BullMQ brings Redis).
function composeServices(extras: readonly Extra[]): Service[] {
  const services: Service[] = [];
  if (extras.includes("redis") || extras.includes("bullmq")) services.push("redis");
  for (const service of ["kafka", "rabbitmq", "mailpit"] as const) {
    if (extras.includes(service)) services.push(service);
  }
  return services;
}

/*
 * Brings the project to `features`: its files (users routes for memory, a database or accounts; auth;
 * stack; Docker), package.json, .env, ignore files, entry imports and pnpm settings, then sabit.json.
 * Returns the next steps to print. Files you changed are kept (see Writer).
 */
export async function applyFeatures(
  project: Project,
  features: Features,
  out: Output,
): Promise<Array<[string, string]>> {
  const { dir, ext, framework, pm } = project;
  const nest = framework.id === "nest";
  const quoted = (source: string) => (project.single ? source.replaceAll('"', "'") : source);
  const state = readState(dir) ?? { features: { extras: [] }, files: {} };
  const writer = new Writer(dir, state, out);
  const stack = {
    database: features.database,
    orm: features.orm,
    extras: features.extras,
    auth: features.auth,
  };
  const plan = planStack(stack, { name: project.name, ext, nest });
  const services = composeServices(features.extras);
  const docker = features.docker;
  const compose = docker?.compose && (docker.app || features.database || services.length > 0);
  if (compose) {
    plan.scripts["docker:up"] = docker?.app
      ? "docker compose up --build --renew-anon-volumes"
      : "docker compose up -d";
    plan.scripts["docker:down"] = "docker compose down";
  }

  for (const [file, content] of plan.files) {
    if (file === "src/env.ts") continue;
    await writer.write(file, file.endsWith(".ts") ? quoted(content) : content);
  }
  if (!features.auth) await writer.write("src/auth/index.ts", quoted(authPlaceholderFile()));
  for (const file of LEGACY_AUTH_FILES) await writer.remove(file);
  for (const file of [...OLD_DOCS_FILES, ...OLD_AUTH_ROUTES]) await writer.remove(file);
  for (const folder of [
    "src/routes/docs/openapi.json",
    "src/routes/docs",
    "src/routes/auth/[...all]",
  ]) {
    await removeIfEmpty(join(dir, folder));
  }
  await exportAccessList(dir, out);
  await useAuthFolder(writer, ext, out);

  const suffix = nest ? ".spec.ts" : ".test.ts";
  const style = {
    importExtension: ext,
    quote: project.single ? "single" : "double",
    alias: project.alias,
  } as const;
  for (const file of planScaffold("users", { ...style, authIn: "middleware" })) {
    const item = file.file.includes("[");
    const route = `src/routes/${file.file}`;
    const test = `test/routes/${file.file.replace(/\.ts$/, suffix)}`;
    if (features.auth) {
      if (file.kind !== "route") await writer.write(route, quoted(ACCOUNTS_SCHEMA));
      else await writer.remove(test);
    } else if (features.orm && file.kind === "route") {
      await writer.write(route, quoted(item ? usersItemRoute(ext) : usersCollectionRoute(ext)));
      const at = testLocation(file.file, ext, "src/db/users.repository.pattern", project.alias);
      await writer.write(
        test,
        quoted((item ? itemRouteTest : collectionRouteTest)(file.pattern, "user", at)),
      );
    } else {
      await writer.write(route, file.content);
      if (file.test) await writer.write(test, file.test);
    }
  }
  const treeImport = project.alias ? `#src/sabit.route${ext}` : `../src/sabit.route${ext}`;
  await writer.write("test/request.ts", quoted(requestHelperFile(treeImport, features.auth)));
  if (features.auth === "jwt") await writer.write("test/memory.ts", quoted(MEMORY_TEST_REPOSITORY));
  if (features.auth) {
    await writer.write(`test/routes/auth/flow${suffix}`, quoted(authFlowTest(ext, features.auth)));
  }

  // Who may call what: the users routes' rules, and the auth routes when there's authentication.
  const routesDir = join(dir, "src/routes");
  const quote = project.single ? "single" : "double";
  const users = planScaffold("users", { ...style, authIn: "middleware" });
  await addAccessRules(routesDir, users, quote);
  if (features.auth) {
    const access = AUTH_ACCESS[features.auth];
    await replaceAccessRule(
      routesDir,
      "/users",
      ["{ POST: true }"],
      access["/users"] as string,
      quote,
    );
    await replaceAccessRule(
      routesDir,
      "/users/[id]",
      ['{ PUT: true, PATCH: true, DELETE: "admin" }'],
      access["/users/[id]"] as string,
      quote,
    );
    await addAccessRules(
      routesDir,
      Object.entries(access).map(([pattern, access]) => ({
        file: "",
        kind: "route" as const,
        pattern,
        methods: [],
        content: "",
        access,
      })),
      quote,
    );
  }

  if (docker?.dockerfile) {
    const main = nest ? "dist/main.js" : "dist/index.js";
    const options = { prismaEngine: plan.prismaEngine, localRegistry: project.localRegistry };
    await writer.write("Dockerfile", dockerfile(pm, main, options));
    await writer.write(".dockerignore", dockerignoreFile());
  }
  if (compose) {
    const choice = {
      app: docker?.app ?? false,
      database: features.database,
      services,
      localRegistry: project.localRegistry,
    };
    await writer.write("docker-compose.yml", composeFile(project.name, choice));
  }

  await mergePackageJson(dir, plan, out);
  await mergeEnv(dir, plan.env, out);
  await appendLines(dir, ".gitignore", plan.ignore);
  await appendLines(dir, ".prettierignore", plan.ignore);
  await addEntryImports(dir, nest, ext, project.single, plan.entryImports, out);
  const builds = { ...(nest ? {} : { esbuild: false }), ...plan.builds };
  if (pm === "pnpm" && !project.repo) await mergePnpmBuilds(dir, builds);

  state.features = features;
  await writeFile(join(dir, "sabit.json"), `${JSON.stringify(state, null, 2)}\n`);

  const steps: Array<[string, string]> = [];
  if (compose && docker?.app) {
    steps.push([runScript(pm, "docker:up"), "run everything in Docker, reloading on save"]);
  } else if (compose) {
    steps.push([runScript(pm, "docker:up"), "start the database and services"]);
  } else if (features.database || features.extras.length > 0) {
    steps.push([
      "",
      `Point the URLs in .env at running servers, or let Docker run them: ${execBin(pm)} setup docker`,
    ]);
  }
  if (features.orm === "drizzle") {
    steps.push([
      `${runScript(pm, "db:generate")} && ${runScript(pm, "db:migrate")}`,
      "create the tables",
    ]);
  } else if (
    (features.orm === "prisma" && features.database === "postgres") ||
    features.orm === "kysely"
  ) {
    steps.push([
      runScript(pm, "db:migrate"),
      `create the tables (${runScript(pm, "dev")} also does it)`,
    ]);
  }
  if (features.auth) steps.push(["", adminHint(features.auth)]);
  return steps;
}

/*
 * Projects from before src/auth/ import src/auth.ts and src/db/seed.ts: points every import in src/
 * and test/ at src/auth/ instead. Only the paths change; files sabit wrote keep their fingerprint.
 */
async function useAuthFolder(writer: Writer, ext: string, out: Output): Promise<void> {
  const moves: Array<[RegExp, string]> = [
    [new RegExp(`(["'])(#src|\\.)/auth\\${ext}\\1`, "g"), `$1$2/auth/index${ext}$1`],
    [new RegExp(`(["'])(#src|\\.)/db/seed\\${ext}\\1`, "g"), `$1$2/auth/seed${ext}$1`],
  ];
  for (const name of await sourceFiles(writer.dir, ["src", "test"])) {
    const content = await readFile(join(writer.dir, name), "utf8");
    const moved = moves.reduce((text, [from, to]) => text.replace(from, to), content);
    if (moved === content) continue;
    await writeFile(join(writer.dir, name), moved);
    if (writer.state.files[name] === sha(content)) writer.state.files[name] = sha(moved);
    out.log(`  updated  ${name}`);
  }
}

// Removes `dir` if it's an empty folder (one the old docs or auth files left behind).
async function removeIfEmpty(dir: string): Promise<void> {
  if (existsSync(dir) && (await readdir(dir)).length === 0) await rm(dir, { recursive: true });
}

// The API docs read the access list, so src/middleware.ts from before them gets `export` on it.
async function exportAccessList(dir: string, out: Output): Promise<void> {
  const file = join(dir, "src/middleware.ts");
  if (!existsSync(file)) return;
  const content = await readFile(file, "utf8");
  if (!/^const access\b/m.test(content)) return;
  await writeFile(file, content.replace(/^const access\b/m, "export const access"));
  out.log("  updated  src/middleware.ts");
}

// The .ts files under these folders of `dir`, as paths relative to it.
async function sourceFiles(dir: string, folders: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const folder of folders) {
    if (!existsSync(join(dir, folder))) continue;
    const entries = await readdir(join(dir, folder), { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      files.push(relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"));
    }
  }
  return files;
}

// Adds the stack's imports, dependencies and scripts to package.json, keeping what's there.
async function mergePackageJson(
  dir: string,
  plan: ReturnType<typeof planStack>,
  out: Output,
): Promise<void> {
  const file = join(dir, "package.json");
  const pkg = JSON.parse(await readFile(file, "utf8")) as {
    imports?: Record<string, unknown>;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const before = JSON.stringify(pkg);
  const sorted = (deps: Record<string, string>) =>
    Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
  pkg.imports = { ...plan.imports, ...pkg.imports };
  if (Object.keys(pkg.imports).length === 0) delete pkg.imports;
  pkg.scripts = { ...plan.scripts, ...pkg.scripts };
  const prepare = plan.prepare.map((command) => `${command} && `).join("");
  if (prepare && pkg.scripts.build && !pkg.scripts.build.startsWith(prepare)) {
    pkg.scripts.build = prepare + pkg.scripts.build;
  }
  pkg.dependencies = sorted({ ...plan.dependencies, ...pkg.dependencies });
  pkg.devDependencies = sorted({ ...plan.devDependencies, ...pkg.devDependencies });
  if (JSON.stringify(pkg) === before) return;
  await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
  out.log("  updated  package.json");
}

// Adds missing keys to .env and .env.example (which gets a placeholder instead of a secret).
async function mergeEnv(dir: string, lines: readonly string[], out: Output): Promise<void> {
  for (const name of [".env", ".env.example"]) {
    const file = join(dir, name);
    const current = existsSync(file) ? await readFile(file, "utf8") : "";
    const keys = new Set(current.split("\n").map((line) => line.split("=")[0]?.trim()));
    const missing = lines
      .filter((line) => !keys.has(line.split("=")[0]))
      .map((line) => (name === ".env.example" ? placeholderSecret(line) : line));
    if (missing.length === 0) continue;
    const separator = current === "" || current.endsWith("\n") ? "" : "\n";
    await writeFile(file, `${current}${separator}${missing.join("\n")}\n`);
    out.log(`  ${current ? "updated" : "created"}  ${name}`);
  }
}

// .env.example gets placeholders, never the generated secrets.
function placeholderSecret(line: string): string {
  const key = line.split("=")[0];
  if (key === "JWT_SECRET" || key === "BETTER_AUTH_SECRET") {
    return `${key}=replace-with-a-random-string-of-32-or-more-characters`;
  }
  return line;
}

// Appends lines a file doesn't have yet, under a "# Generated code" heading.
async function appendLines(dir: string, name: string, lines: readonly string[]): Promise<void> {
  const file = join(dir, name);
  if (!existsSync(file) || lines.length === 0) return;
  const current = await readFile(file, "utf8");
  const missing = lines.filter((line) => !current.split("\n").includes(line));
  if (missing.length === 0) return;
  await writeFile(file, `${current.trimEnd()}\n\n# Generated code\n${missing.join("\n")}\n`);
}

// Adds side-effect imports (queue workers, the admin seed) after the server entry's last import.
async function addEntryImports(
  dir: string,
  nest: boolean,
  ext: string,
  single: boolean,
  paths: readonly string[],
  out: Output,
): Promise<void> {
  const name = nest ? "src/main.ts" : "src/index.ts";
  const file = join(dir, name);
  if (!existsSync(file) || paths.length === 0) return;
  const content = await readFile(file, "utf8");
  const q = single ? "'" : '"';
  const missing = paths
    .map((path) => `import ${q}./${path}${ext}${q};`)
    .filter((line) => !content.includes(line));
  if (missing.length === 0) return;
  const lines = content.split("\n");
  const lastImport = lines.findLastIndex((line) => line.startsWith("import "));
  lines.splice(lastImport + 1, 0, ...missing);
  await writeFile(file, lines.join("\n"));
  out.log(`  updated  ${name}`);
}

// Records which dependencies' install scripts pnpm may run (true) or skip (false).
async function mergePnpmBuilds(dir: string, builds: Record<string, boolean>): Promise<void> {
  const file = join(dir, "pnpm-workspace.yaml");
  const entries = Object.entries(builds);
  if (entries.length === 0) return;
  const current = existsSync(file) ? await readFile(file, "utf8") : "";
  const missing = entries.filter(([name]) => !new RegExp(`^\\s+"?${name}"?:`, "m").test(current));
  if (missing.length === 0) return;
  const lines = missing.map(([name, allow]) => `  "${name}": ${allow}`).join("\n");
  const next = current.includes("allowBuilds:")
    ? current.replace("allowBuilds:", `allowBuilds:\n${lines}`)
    : `${current}${current && !current.endsWith("\n") ? "\n" : ""}allowBuilds:\n${lines}\n`;
  await writeFile(file, next);
}
