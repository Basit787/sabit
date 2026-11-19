import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import * as prompts from "@clack/prompts";
import { refreshEnvFile, refreshRouteTree } from "../codegen.ts";
import type { Command, Output } from "../command.ts";
import { applyFeatures, askFeatures, detectProject, type Features } from "../features.ts";
import { FRAMEWORKS, type Framework, findFramework, templateDir } from "../frameworks.ts";
import {
  cliVersion,
  detectPackageManager,
  execBin,
  findSabitRepo,
  type PackageManager,
  runScript,
} from "../project.ts";
import { listRoutesInMiddleware } from "../route-watcher.ts";
import { detectImportExtension, detectQuoteStyle, routePatterns } from "../scaffold.ts";
import { appMiddlewareFile } from "../templates.ts";

const PACKAGE_MANAGERS: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];
const LINTERS = ["default", "biome", "none"] as const;
type Linter = (typeof LINTERS)[number];

// Files and dev dependencies that belong to each starter's default lint/format setup.
const DEFAULT_LINT_FILES = ["eslint.config.ts", ".oxlintrc.json", ".prettierrc", ".prettierignore"];
const DEFAULT_LINT_DEPS = [
  "@eslint/js",
  "eslint",
  "globals",
  "jiti",
  "oxlint",
  "oxlint-tsgolint",
  "prettier",
  "typescript-eslint",
];
const BIOME_VERSION = "2.6.8";

/*
 * `sabit init`: copies the starter, adds the chosen stack, Docker and auth files, the users routes, tests
 * and src/middleware.ts with every route in its access list. Inside the sabit repo it uses pnpm workspace:*;
 * a custom registry is kept in .npmrc (and reached as host.docker.internal from Docker).
 */
export const init: Command = {
  name: "init",
  aliases: ["create"],
  summary: "Create a backend project (Express, Hono, Fastify or NestJS) with file-based routing",
  usage: `sabit init [dir] [options]

  Creates the framework's standard starter project with file-based routing
  set up, plus example /users endpoints in src/routes. Existing files are
  never overwritten. In a terminal, anything not given as an option is asked.

  Options:
    --framework <express|hono|fastify|nest>
    --pm <npm|pnpm|yarn|bun>          package manager
    --lint <default|biome|none>       default: ESLint + Prettier (Express, Hono, Fastify),
                                      oxlint + Prettier (NestJS)
    --db <postgres|mongodb|none>      database, with its connection code
    --orm <prisma|drizzle|kysely|mongoose|typegoose>
                                      default: prisma (postgres), mongoose (mongodb);
                                      mongodb also takes typegoose (NestJS) or prisma
    --auth <jwt|better-auth|none>     sign-up, login and sessions (Better Auth needs --db)
    --with <redis,bullmq,kafka,rabbitmq,mailpit>
                                      extra services, comma-separated
    --install / --no-install          install dependencies
    --git / --no-git                  initialize a git repository
    --yes, -y                         accept defaults for anything not given`,
  options: {
    framework: { type: "string", short: "f" },
    pm: { type: "string" },
    lint: { type: "string" },
    db: { type: "string" },
    orm: { type: "string" },
    with: { type: "string" },
    auth: { type: "string" },
    install: { type: "boolean" },
    "no-install": { type: "boolean" },
    git: { type: "boolean" },
    "no-git": { type: "boolean" },
    yes: { type: "boolean", short: "y" },
  },
  async run({ args, flags, cwd, out, interactive }) {
    const ask = interactive && flags.yes !== true;
    if (ask) prompts.intro("Create a sabit project");
    const answers = await collectAnswers(args[0], flags, ask, out);
    if (!answers) return 1;
    const { framework, lint, features, install, git } = answers;

    const dir = resolve(cwd, answers.dir);
    const repo = findSabitRepo(dir);
    const pm = repo ? "pnpm" : answers.pm;
    if (pm !== answers.pm) {
      out.log(`Using pnpm instead of ${answers.pm}: this project is inside the sabit repository.`);
    }
    const version = cliVersion();
    const vars: Record<string, string> = {
      name: packageName(dir),
      kit: repo ? "workspace:*" : `^${version}`,
    };

    await mkdir(dir, { recursive: true });
    const written = await copyTemplate(templateDir(framework), dir, vars, out, (file, content) =>
      adjustForLinter(file, content, lint),
    );
    if (lint === "biome" && !existsSync(join(dir, "biome.json"))) {
      await writeFile(join(dir, "biome.json"), biomeConfig(framework));
      written.push("biome.json");
    }
    const registry = customRegistry(process.env);
    if (registry && !repo && !existsSync(join(dir, ".npmrc"))) {
      await writeFile(join(dir, ".npmrc"), `registry=${registry}\n`);
      written.push(".npmrc");
    }

    const where = relative(cwd, dir) || ".";
    out.log("");
    out.log(`Created a new ${framework.label} project in ${where}`);
    for (const file of written) out.log(`  created  ${file}`);
    const routesDir = join(dir, "src/routes");
    const middleware = join(dir, "src/middleware.ts");
    if (!existsSync(middleware)) {
      const source = appMiddlewareFile(
        (await routePatterns(routesDir)).map((pattern) => [pattern, "false"] as const),
        detectImportExtension(dir),
      );
      await writeFile(
        middleware,
        detectQuoteStyle(dir) === "single" ? source.replaceAll('"', "'") : source,
      );
      out.log("  created  src/middleware.ts");
    }
    const project = detectProject(dir);
    if (!project) {
      out.error("The starter has no @sabit adapter in package.json.");
      return 1;
    }
    const steps = await applyFeatures({ ...project, pm }, features, out);
    if (!(await refreshRouteTree(dir, routesDir, out, { create: true, quiet: true }))) return 1;
    await listRoutesInMiddleware(dir, routesDir, out);
    await refreshEnvFile(dir, routesDir, out);

    let failed = false;
    if (git) initGit(dir, out);
    if (install) {
      out.log("");
      out.log(`Installing dependencies with ${pm}...`);
      const result = spawnSync(`${pm} install`, { cwd: dir, stdio: "inherit", shell: true });
      if (result.status === 0 && lint === "biome") {
        spawnSync("node_modules/.bin/biome check --write .", {
          cwd: dir,
          stdio: "ignore",
          shell: true,
        });
      }
      if (result.status !== 0) {
        failed = true;
        out.error(
          `\nInstalling dependencies failed. Your project is ready; fix the error above, then run \`${pm} install\` in ${where}.`,
        );
      }
    }

    printSteps(
      [
        ...(where !== "." ? [[`cd ${where}`, ""] as [string, string]] : []),
        ...(!install || failed ? [[`${pm} install`, ""] as [string, string]] : []),
        ...steps,
        [runScript(pm, "dev"), "start with reload on http://localhost:3000"],
        [`${execBin(pm)} add products`, "add /products endpoints"],
        ["mkdir src/routes/orders", "(while dev runs) adds /orders endpoints"],
      ],
      pm,
      out,
    );
    if (!repo && !registry && version === "0.0.0") {
      out.log("");
      out.log("Note: sabit isn't published to npm yet, so installing will fail for now.");
    }
    return failed ? 1 : 0;
  },
};

const PUBLIC_REGISTRIES = ["https://registry.npmjs.org", "https://registry.yarnpkg.com"];

// The registry this command was run with, if it isn't the public npm registry.
export function customRegistry(env: NodeJS.ProcessEnv): string | undefined {
  const registry = (env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY)?.trim();
  if (!registry) return undefined;
  const normalized = registry.replace(/\/+$/, "");
  return PUBLIC_REGISTRIES.includes(normalized) ? undefined : registry;
}

interface Answers {
  readonly dir: string;
  readonly framework: Framework;
  readonly pm: PackageManager;
  readonly lint: Linter;
  readonly features: Features;
  readonly install: boolean;
  readonly git: boolean;
}

/*
 * Each answer comes from its flag, else a prompt (in a terminal), else the default. Install and git
 * default to yes when asked, no in scripts. Undefined on invalid flags or Ctrl+C.
 */
async function collectAnswers(
  dirArg: string | undefined,
  flags: Readonly<Record<string, string | boolean | undefined>>,
  ask: boolean,
  out: Output,
): Promise<Answers | undefined> {
  const cancelled = (value: unknown): value is symbol => {
    if (!prompts.isCancel(value)) return false;
    prompts.cancel("Cancelled. Nothing was created.");
    return true;
  };

  let dir = dirArg ?? ".";
  if (dirArg === undefined && ask) {
    const answer = await prompts.text({
      message: "Project folder",
      placeholder: "my-api",
      defaultValue: "my-api",
    });
    if (cancelled(answer)) return undefined;
    dir = answer.trim() || "my-api";
  }

  const frameworkFlag = flags.framework as string | undefined;
  let framework = frameworkFlag ? findFramework(frameworkFlag) : undefined;
  if (frameworkFlag && !framework) {
    out.error(
      `Unknown framework "${frameworkFlag}". Choose: ${FRAMEWORKS.map((f) => f.id).join(", ")}`,
    );
    return undefined;
  }
  if (!framework) {
    if (!ask) {
      out.error(`Pass --framework (${FRAMEWORKS.map((f) => f.id).join(", ")})`);
      return undefined;
    }
    const answer = await prompts.select<Framework["id"]>({
      message: "Which framework?",
      options: FRAMEWORKS.map((f) => ({ value: f.id, label: f.label })),
      initialValue: "express",
    });
    if (cancelled(answer)) return undefined;
    framework = findFramework(answer) as Framework;
  }

  const pmFlag = flags.pm as string | undefined;
  if (pmFlag && !PACKAGE_MANAGERS.includes(pmFlag as PackageManager)) {
    out.error(`Unknown package manager "${pmFlag}". Choose: ${PACKAGE_MANAGERS.join(", ")}`);
    return undefined;
  }
  let pm = (pmFlag as PackageManager | undefined) ?? detectPackageManager();
  if (!pmFlag && ask) {
    const answer = await prompts.select({
      message: "Which package manager?",
      options: PACKAGE_MANAGERS.map((p) => ({ value: p, label: p })),
      initialValue: pm,
    });
    if (cancelled(answer)) return undefined;
    pm = answer;
  }

  const lintFlag = flags.lint as string | undefined;
  if (lintFlag && !LINTERS.includes(lintFlag as Linter)) {
    out.error(`Unknown --lint "${lintFlag}". Choose: ${LINTERS.join(", ")}`);
    return undefined;
  }
  let lint = (lintFlag as Linter | undefined) ?? "default";
  if (!lintFlag && ask) {
    const answer = await prompts.select<Linter>({
      message: "Which linter and formatter?",
      options: [
        {
          value: "default",
          label: framework.id === "nest" ? "oxlint + Prettier" : "ESLint + Prettier",
          hint: `${framework.label} default`,
        },
        { value: "biome", label: "Biome", hint: "one fast tool for both" },
        { value: "none", label: "None" },
      ],
      initialValue: "default",
    });
    if (cancelled(answer)) return undefined;
    lint = answer;
  }

  const features = await askFeatures({
    installed: { extras: [] },
    framework,
    flags,
    ask,
    gate: true,
    out,
    cancelled,
  });
  if (!features) return undefined;

  const yesNo = async (flag: string, message: string): Promise<boolean | undefined> => {
    if (flags[flag] === true) return true;
    if (flags[`no-${flag}`] === true) return false;
    if (!ask) return false;
    const answer = await prompts.confirm({ message, initialValue: true });
    return cancelled(answer) ? undefined : answer;
  };
  const install = await yesNo("install", `Install dependencies with ${pm}?`);
  if (install === undefined) return undefined;
  const git = await yesNo("git", "Initialize a git repository?");
  if (git === undefined) return undefined;

  return { dir, framework, pm, lint, features, install, git };
}

// Drops the default lint setup's files, scripts and dependencies when another linter is chosen.
function adjustForLinter(file: string, content: string, lint: Linter): string | null {
  if (lint === "default") return content;
  if (DEFAULT_LINT_FILES.includes(file)) return null;
  if (file !== "package.json") return content;

  const pkg = JSON.parse(content) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  for (const dep of DEFAULT_LINT_DEPS) delete pkg.devDependencies[dep];
  delete pkg.scripts.lint;
  delete pkg.scripts.format;
  if (lint === "biome") {
    pkg.scripts.lint = "biome check .";
    pkg.scripts.format = "biome format --write .";
    pkg.devDependencies["@biomejs/biome"] = `^${BIOME_VERSION}`;
    pkg.devDependencies = Object.fromEntries(
      Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/*
 * biome.json for a starter: source code only (the route tree is generated); NestJS keeps value imports
 * and parameter decorators for DI. Short arrays stay on one line, as Biome formats its own config.
 */
function biomeConfig(framework: Framework): string {
  const config = {
    $schema: `https://biomejs.dev/schemas/${BIOME_VERSION}/schema.json`,
    files: { includes: ["src/**", "test/**", "!src/sabit.route.ts"] },
    formatter: { indentStyle: "space", lineWidth: 100 },
    linter: {
      rules: {
        preset: "recommended",
        ...(framework.id === "nest" ? { style: { useImportType: "off" } } : {}),
      },
    },
    javascript: {
      formatter: { quoteStyle: framework.id === "nest" ? "single" : "double" },
      ...(framework.id === "nest" ? { parser: { unsafeParameterDecoratorsEnabled: true } } : {}),
    },
    assist: { actions: { source: { organizeImports: "on" } } },
  };
  const json = JSON.stringify(config, null, 2).replace(
    /\[\n\s+((?:"[^"\n]*",?\s*)+)\n\s*\]/g,
    (_match, items: string) => `[${items.trim().split(/,\s*/).join(", ")}]`,
  );
  return `${json}\n`;
}

function initGit(dir: string, out: Output): void {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (inside.error) {
    out.error("  git isn't installed; skipped creating a repository.");
    return;
  }
  if (inside.status === 0 && inside.stdout.trim() === "true") {
    out.log("  git      already inside a repository; skipped git init");
    return;
  }
  const result = spawnSync("git", ["init", "--quiet"], { cwd: dir });
  if (result.status === 0) out.log("  git      initialized a repository");
  else out.error("  git init failed; you can run it yourself later.");
}

function packageName(dir: string): string {
  return (
    basename(dir)
      .toLowerCase()
      .replace(/[^a-z0-9-_.]/g, "-")
      .replace(/^[-_.]+/, "") || "app"
  );
}

// Template names stored without a leading dot, so npm publishes them intact.
const DOTFILE_NAMES: Record<string, string> = { _gitignore: ".gitignore", _vscode: ".vscode" };

/*
 * Copies a template, filling `{{name}}`/`{{kit}}`; `_gitignore` and `_vscode` get their dots back.
 * `transform` rewrites a file or skips it (null). Existing files are kept; package.json is merged.
 */
async function copyTemplate(
  from: string,
  to: string,
  vars: Record<string, string>,
  out: Output,
  transform: (file: string, content: string) => string | null,
): Promise<string[]> {
  const written: string[] = [];
  const entries = await readdir(from, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  for (const source of files) {
    const relativePath = relative(from, source)
      .split(/[\\/]/)
      .map((part) => DOTFILE_NAMES[part] ?? part)
      .join("/");
    const filled = (await readFile(source, "utf8")).replace(
      /\{\{(\w+)\}\}/g,
      (match, key: string) => vars[key] ?? match,
    );
    const content = transform(relativePath, filled);
    if (content === null) continue;

    const target = join(to, relativePath);
    if (existsSync(target)) {
      if (relativePath === "package.json") {
        await mergePackageJson(target, JSON.parse(content), out);
        written.push("package.json (merged)");
      }
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    written.push(relativePath);
  }
  return written;
}

async function mergePackageJson(path: string, template: Record<string, unknown>, out: Output) {
  const pkg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (pkg.type !== "module") {
    out.error(
      'package.json has no "type": "module"; the generated files use ES modules. Add it to package.json.',
    );
  }
  for (const key of ["scripts", "dependencies", "devDependencies"]) {
    const merged = {
      ...(template[key] as Record<string, string> | undefined),
      ...(pkg[key] as Record<string, string> | undefined),
    };
    pkg[key] = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  }
  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

// Prints the next steps, then how to add more later with `sabit setup`.
export function printSteps(
  steps: ReadonlyArray<[string, string]>,
  pm: PackageManager,
  out: Output,
) {
  const commands = steps.filter(([command]) => command);
  const width = Math.max(...commands.map(([command]) => command.length));
  out.log("");
  out.log("Next steps:");
  for (const [command, note] of commands) out.log(`  ${command.padEnd(width)}   ${note}`.trimEnd());
  for (const [command, note] of steps) if (!command) out.log(`  ${note}`);
  out.log("");
  out.log("Add more any time: a database, auth, Redis, queues, email or Docker");
  out.log(`  ${execBin(pm)} setup`);
}
