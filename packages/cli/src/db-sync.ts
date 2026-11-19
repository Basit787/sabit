import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import type { Output } from "./command.ts";
import { drizzleMigrations, type MigrationFolder, prismaMigrations } from "./migration-name.ts";
import { detectOrm } from "./stack.ts";

/*
 * How a project keeps its database and client in step with its schema: `commands` run in order (each
 * even if the one before failed), again whenever a `watch` path changes. The first command creates
 * migrations in `migrations`; they're named after their SQL before the next command applies them.
 */
export interface DbSync {
  readonly label: string;
  readonly commands: readonly string[];
  readonly watch: readonly string[];
  readonly migrations?: MigrationFolder;
}

/*
 * What `sabit dev` runs at start and on schema changes: Prisma migrates (a migration only when the schema
 * changed; pushes on MongoDB) and generates, Drizzle generates and migrates, Kysely applies pending ones.
 */
export function dbSync(projectRoot: string): DbSync | undefined {
  const pkgFile = join(projectRoot, "package.json");
  if (!existsSync(pkgFile)) return undefined;
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const orm = detectOrm({ ...pkg.devDependencies, ...pkg.dependencies });
  if (orm === "prisma") {
    const schema = "prisma/schema.prisma";
    if (!existsSync(join(projectRoot, schema))) return undefined;
    const mongo = /provider\s*=\s*"mongodb"/.test(readFileSync(join(projectRoot, schema), "utf8"));
    return {
      label: "Prisma",
      commands: mongo
        ? ["prisma db push --skip-generate", "prisma generate"]
        : [
            "prisma migrate dev --create-only --name schema",
            "prisma migrate dev --name schema",
            "prisma generate",
          ],
      watch: [schema],
      ...(mongo ? {} : { migrations: prismaMigrations(projectRoot) }),
    };
  }
  if (orm === "drizzle") {
    return {
      label: "Drizzle",
      commands: ["drizzle-kit generate", "drizzle-kit migrate"],
      watch: ["src/db/schema.ts"],
      migrations: drizzleMigrations(projectRoot),
    };
  }
  if (orm === "kysely" && pkg.scripts?.["db:migrate"]) {
    return {
      label: "Kysely",
      commands: [pkg.scripts["db:migrate"]],
      watch: ["src/db/migrations"],
    };
  }
  return undefined;
}

/*
 * Runs the sync commands; a failure (database not running) is reported, not fatal. A database whose
 * migration history doesn't match (left from another project of the same name) gets its own hint.
 */
export function runDbSync(projectRoot: string, sync: DbSync, out: Output): void {
  const env = {
    ...process.env,
    PATH: `${join(projectRoot, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
  };
  let failed = false;
  let drift = false;
  const before = sync.migrations?.list() ?? [];
  for (const [index, command] of sync.commands.entries()) {
    if (index === 1 && sync.migrations) nameNewMigrations(sync, before, out);
    const result = spawnSync(command, {
      cwd: projectRoot,
      env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: true,
      encoding: "utf8",
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (result.status !== 0) failed = true;
    if (DRIFT.test(`${result.stdout}${result.stderr}`)) drift = true;
  }
  if (drift) {
    out.error(DRIFT_HINT(sync.label));
  } else if (failed) {
    out.error(
      `  ${sync.label}: the database step failed (see above; is the database running?); starting the server anyway`,
    );
  }
}

// Names the migrations the first command created after what they change, e.g. add_nickname_to_users.
function nameNewMigrations(sync: DbSync, before: readonly string[], out: Output): void {
  const folder = sync.migrations as MigrationFolder;
  for (const id of folder.list().filter((id) => !before.includes(id))) {
    try {
      out.log(`  ${sync.label}: new migration ${folder.rename(id, before.length === 0)}`);
    } catch (error) {
      out.error(`  ${sync.label}: couldn't name migration ${id}: ${(error as Error).message}`);
    }
  }
}

// What Prisma prints when the database's migrations aren't this project's.
const DRIFT = /Drift detected|We need to reset|missing from the local migrations directory/;

const DRIFT_HINT = (label: string) =>
  `  ${label}: the database has tables and migrations this project didn't make, usually from an earlier
  project with the same name (Docker keeps its database volume). Nothing was changed, so requests that
  use the database will fail. Start the database over (its data is deleted): npx prisma migrate reset --force`;

/*
 * Runs the sync again whenever a watched path changes. Files are watched through their folder, because
 * editors often save by replacing the file.
 */
export function watchDbSync(projectRoot: string, sync: DbSync, out: Output): { close(): void } {
  let pending: NodeJS.Timeout | undefined;
  const rerun = () => {
    clearTimeout(pending);
    pending = setTimeout(() => runDbSync(projectRoot, sync, out), 300);
  };
  const watchers = sync.watch
    .map((path) => join(projectRoot, path))
    .filter((path) => existsSync(path))
    .map((path) => {
      if (statSync(path).isDirectory()) return watch(path, rerun);
      return watch(dirname(path), (_event, name) => {
        if (name?.toString() === basename(path)) rerun();
      });
    });
  return {
    close() {
      clearTimeout(pending);
      for (const watcher of watchers) watcher.close();
    },
  };
}
