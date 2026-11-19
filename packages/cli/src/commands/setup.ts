import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as prompts from "@clack/prompts";
import { refreshEnvFile, refreshRouteTree } from "../codegen.ts";
import type { Command } from "../command.ts";
import {
  applyFeatures,
  askFeatures,
  detectFeatures,
  detectProject,
  type Features,
  readState,
} from "../features.ts";
import { isProduction, resolveRoutesDir, runScript } from "../project.ts";
import { listRoutesInMiddleware } from "../route-watcher.ts";
import type { Extra } from "../stack.ts";
import { printSteps } from "./init.ts";

const FEATURES = ["database", "auth", "redis", "bullmq", "kafka", "rabbitmq", "email", "docker"];

/*
 * `sabit setup [feature...]`: adds a database, auth, services or Docker to an existing project. It
 * offers only what isn't set up, writes the files (keeping ones you changed: sabit's version goes
 * next to them as <file>.sabit-new), updates package.json and .env, then installs.
 */
export const setup: Command = {
  name: "setup",
  summary: "Add a database, auth, Redis, queues, email or Docker to this project",
  usage: `sabit setup [feature...] [options]

  Shows what this project doesn't have yet and sets up what you pick: files,
  dependencies, scripts and .env keys. Run it again any time. Files you
  changed are kept; sabit's version goes next to them as <file>.sabit-new.

  Features: database, auth, redis, bullmq, kafka, rabbitmq, email, docker
    sabit setup                 pick from a menu
    sabit setup auth docker     set these up (their questions are still asked)

  Options:
    --db <postgres|mongodb>     --orm <prisma|drizzle|kysely|mongoose|typegoose>
    --auth <jwt|better-auth>    --with <redis,bullmq,kafka,rabbitmq,mailpit>
    --no-install                don't install the new dependencies`,
  options: {
    db: { type: "string" },
    orm: { type: "string" },
    with: { type: "string" },
    auth: { type: "string" },
    "no-install": { type: "boolean" },
  },
  async run({ args, flags, cwd, out, interactive }) {
    if (isProduction("setup", out)) return 1;
    const project = detectProject(cwd);
    if (!project) {
      out.error("No sabit project here: run this in a project made with `sabit init`.");
      return 1;
    }
    const unknown = args.find((arg) => !FEATURES.includes(arg));
    if (unknown) {
      out.error(`Unknown feature "${unknown}". Choose: ${FEATURES.join(", ")}`);
      return 1;
    }
    if (!interactive && args.length === 0 && !flags.db && !flags.auth && !flags.with) {
      out.error(`Name what to add (no terminal for the menu): sabit setup <${FEATURES.join("|")}>`);
      return 1;
    }
    const installed = readState(cwd)?.features ?? detectFeatures(cwd);
    const preselected = args.map((arg) => (arg === "email" ? "mailpit" : arg));
    const cancelled = (value: unknown): value is symbol => {
      if (!prompts.isCancel(value)) return false;
      prompts.cancel("Cancelled. Nothing was changed.");
      return true;
    };
    if (interactive) prompts.intro("Set up more for this project");
    const asked = await askFeatures({
      installed,
      framework: project.framework,
      flags,
      ask: interactive,
      gate: false,
      preselected,
      out,
      cancelled,
    });
    if (!asked) return 1;
    const features = interactive ? asked : withDefaults(asked, preselected);
    if (JSON.stringify(features) === JSON.stringify(installed) && !preselected.includes("docker")) {
      out.log("Nothing to set up.");
      return 0;
    }

    const steps = await applyFeatures(project, features, out);
    const routesDir = resolveRoutesDir(cwd);
    await refreshRouteTree(cwd, routesDir, out, { quiet: true });
    await listRoutesInMiddleware(cwd, routesDir, out);
    await refreshEnvFile(cwd, routesDir, out);
    const middleware = readFileSync(join(cwd, "src/middleware.ts"), "utf8");
    if (features.auth && !middleware.includes("./auth/index")) {
      out.error(
        '  src/middleware.ts doesn\'t use src/auth/: set ctx.state.user = await currentUser(ctx) with `import { currentUser } from "./auth/index.ts"`.',
      );
    }

    let failed = false;
    if (flags["no-install"] !== true) {
      out.log("");
      out.log(`Installing dependencies with ${project.pm}...`);
      failed =
        spawnSync(`${project.pm} install`, { cwd, stdio: "inherit", shell: true }).status !== 0;
      if (failed)
        out.error(`\nInstalling failed; fix the error above, then run \`${project.pm} install\`.`);
    }
    printSteps(
      [
        ...(flags["no-install"] === true || failed
          ? [[`${project.pm} install`, ""] as [string, string]]
          : []),
        ...steps,
        [runScript(project.pm, "dev"), "start with reload on http://localhost:3000"],
      ],
      project.pm,
      out,
    );
    return failed ? 1 : 0;
  },
};

/*
 * Without a terminal, named features take defaults: auth is custom JWT, Docker gets every file, the
 * services are added; a database still needs --db (and --orm, else the first one).
 */
function withDefaults(features: Features, picked: readonly string[]): Features {
  const extras = picked.filter((p) => !["database", "auth", "docker"].includes(p)) as Extra[];
  return {
    ...features,
    extras: [...new Set([...features.extras, ...extras])],
    auth: features.auth ?? (picked.includes("auth") ? "jwt" : undefined),
    docker: picked.includes("docker")
      ? { dockerfile: true, compose: true, app: true }
      : features.docker,
  };
}
