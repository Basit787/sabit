import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * A migration name from its SQL, e.g. create_posts, add_nickname_to_users,
 * remove_age_from_users_and_create_posts; `init` for a project's first migration.
 */
export function migrationName(sql: string, first = false): string {
  if (first) return "init";
  const created: string[] = [];
  const dropped: string[] = [];
  const perTable = new Map<string, Map<string, string[]>>();
  const fallback: string[] = [];
  const on = (table: string, verb: string, column: string) => {
    const verbs = perTable.get(table) ?? new Map<string, string[]>();
    verbs.set(verb, [...(verbs.get(verb) ?? []), column]);
    perTable.set(table, verbs);
  };

  const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
  for (const statement of code.split(";")) {
    const text = statement.replace(/\s+/g, " ").trim();
    let match = /^CREATE TABLE (?:IF NOT EXISTS )?(\S+)/i.exec(text);
    if (match) {
      created.push(word(match[1]));
      continue;
    }
    match = /^DROP TABLE (?:IF EXISTS )?(\S+)/i.exec(text);
    if (match) {
      dropped.push(word(match[1]));
      continue;
    }
    match = /^ALTER TABLE (?:ONLY )?(\S+)/i.exec(text);
    if (match) {
      const table = word(match[1]);
      for (const [, column] of text.matchAll(/ADD COLUMN (?:IF NOT EXISTS )?(\S+)/gi)) {
        on(table, "add", word(column));
      }
      for (const [, column] of text.matchAll(/DROP COLUMN (?:IF EXISTS )?(\S+)/gi)) {
        on(table, "remove", word(column));
      }
      for (const [, column] of text.matchAll(/ALTER COLUMN (\S+)/gi))
        on(table, "change", word(column));
      for (const [, from, to] of text.matchAll(/RENAME COLUMN (\S+) TO (\S+)/gi)) {
        on(table, "rename", `${word(from)}_to_${word(to)}`);
      }
      const renamed = /RENAME TO (\S+)/i.exec(text);
      if (renamed) fallback.push(`rename_${table}_to_${word(renamed[1])}`);
      if (/FOREIGN KEY/i.test(text)) fallback.push(`add_foreign_key_to_${table}`);
      continue;
    }
    match = /^CREATE (?:UNIQUE )?INDEX .*? ON (?:ONLY )?(\S+?)\s*\(/i.exec(text);
    if (match) fallback.push(`add_index_to_${word(match[1])}`);
    match = /^DROP INDEX (?:IF EXISTS )?(\S+)/i.exec(text);
    if (match) fallback.push(`drop_index_${word(match[1])}`);
    match = /^CREATE TYPE (\S+)/i.exec(text);
    if (match) fallback.push(`create_${word(match[1])}_enum`);
  }

  const parts: string[] = [];
  if (created.length > 0) parts.push(`create_${list(created)}`);
  for (const [table, verbs] of perTable) {
    const preposition: Record<string, string> = {
      add: "to",
      remove: "from",
      change: "in",
      rename: "in",
    };
    for (const [verb, columns] of verbs) {
      parts.push(`${verb}_${list(columns)}_${preposition[verb]}_${table}`);
    }
  }
  if (dropped.length > 0) parts.push(`drop_${list(dropped)}`);
  const chosen = parts.length > 0 ? parts : [...new Set(fallback)];
  if (chosen.length === 0) return "schema";
  const name = chosen.length > 2 ? `${chosen[0]}_and_more` : chosen.join("_and_");
  return name.length > 80 ? `${name.slice(0, 80).replace(/_[^_]*$/, "")}_and_more` : name;
}

// A SQL identifier ("User", `users`, public.users) as a lowercase name part.
function word(identifier: string | undefined): string {
  const name = (identifier ?? "").split(".").pop() ?? "";
  return name
    .replace(/["`[\]]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]/g, "")
    .toLowerCase();
}

function list(names: readonly string[]): string {
  const unique = [...new Set(names)];
  return unique.length > 2 ? `${unique[0]}_${unique[1]}_and_more` : unique.join("_and_");
}

// Where an ORM keeps its migrations, so new ones can be found and renamed after they're generated.
export interface MigrationFolder {
  // Ids of the migrations there now.
  list(): string[];
  // Names migration `id` after its SQL (`init` when `first`), returning the new id.
  rename(id: string, first: boolean): string;
}

// Prisma: prisma/migrations/<timestamp>_<name>/migration.sql.
export function prismaMigrations(projectRoot: string): MigrationFolder {
  const dir = join(projectRoot, "prisma/migrations");
  return {
    list: () =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
            .map((entry) => entry.name)
        : [],
    rename(id, first) {
      const sql = readFileSync(join(dir, id, "migration.sql"), "utf8");
      const renamed = `${id.split("_")[0]}_${migrationName(sql, first)}`;
      if (renamed !== id && !existsSync(join(dir, renamed))) {
        renameSync(join(dir, id), join(dir, renamed));
        return renamed;
      }
      return id;
    },
  };
}

// Drizzle: <out>/<index>_<name>.sql, listed in <out>/meta/_journal.json by tag.
export function drizzleMigrations(projectRoot: string): MigrationFolder {
  const config = join(projectRoot, "drizzle.config.ts");
  const out =
    (existsSync(config) &&
      /\bout:\s*["'`]([^"'`]+)["'`]/.exec(readFileSync(config, "utf8"))?.[1]) ||
    "drizzle";
  const dir = join(projectRoot, out);
  const journalFile = join(dir, "meta/_journal.json");
  type Journal = { entries: Array<{ tag: string }> };
  const journal = (): Journal | undefined =>
    existsSync(journalFile)
      ? (JSON.parse(readFileSync(journalFile, "utf8")) as Journal)
      : undefined;
  return {
    list: () => journal()?.entries.map((entry) => entry.tag) ?? [],
    rename(id, first) {
      const data = journal();
      const entry = data?.entries.find((e) => e.tag === id);
      if (!data || !entry) return id;
      const sql = readFileSync(join(dir, `${id}.sql`), "utf8");
      const renamed = `${id.split("_")[0]}_${migrationName(sql, first)}`;
      if (renamed === id || existsSync(join(dir, `${renamed}.sql`))) return id;
      renameSync(join(dir, `${id}.sql`), join(dir, `${renamed}.sql`));
      entry.tag = renamed;
      writeFileSync(journalFile, `${JSON.stringify(data, null, 2)}\n`);
      return renamed;
    },
  };
}
