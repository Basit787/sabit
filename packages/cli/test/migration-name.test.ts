import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drizzleMigrations, migrationName, prismaMigrations } from "../src/migration-name.ts";
import { tempProject } from "./helpers.ts";

describe("migrationName", () => {
  it("names a project's first migration init", () => {
    expect(migrationName('CREATE TABLE "User" ("id" TEXT);', true)).toBe("init");
  });

  it("names Prisma SQL after what changed", () => {
    expect(migrationName('-- CreateTable\nCREATE TABLE "Post" (\n "id" TEXT NOT NULL\n);')).toBe(
      "create_post",
    );
    expect(
      migrationName(
        '-- AlterTable\nALTER TABLE "User" ADD COLUMN "nickname" TEXT,\nADD COLUMN "age" INTEGER;',
      ),
    ).toBe("add_nickname_and_age_to_user");
    expect(migrationName('ALTER TABLE "User" DROP COLUMN "age";')).toBe("remove_age_from_user");
    expect(
      migrationName('ALTER TABLE "RefreshToken" ALTER COLUMN "expiresAt" DROP NOT NULL;'),
    ).toBe("change_expires_at_in_refresh_token");
  });

  it("reads Prisma's padded columns and skips its warning comments", () => {
    const added = [
      "-- AlterTable",
      'ALTER TABLE "User" ADD COLUMN     "age" INTEGER,',
      'ADD COLUMN     "nickname" TEXT;',
      "",
      "-- CreateTable",
      'CREATE TABLE "Post" (\n    "id" TEXT NOT NULL\n);',
    ].join("\n");
    expect(migrationName(added)).toBe("create_post_and_add_age_and_nickname_to_user");
    const dropped =
      '/*\n  Warnings:\n\n  - You are about to drop the column `age` on the `User` table.\n*/\n-- AlterTable\nALTER TABLE "User" DROP COLUMN "age";';
    expect(migrationName(dropped)).toBe("remove_age_from_user");
  });

  it("names Drizzle SQL, joining two changes and shortening more", () => {
    const sql = [
      'CREATE TABLE "posts" ("id" text PRIMARY KEY NOT NULL);',
      'ALTER TABLE "users" ADD COLUMN "nickname" text;',
    ].join("\n--> statement-breakpoint\n");
    expect(migrationName(sql)).toBe("create_posts_and_add_nickname_to_users");
    const more = `${sql}\n--> statement-breakpoint\nDROP TABLE "tags";`;
    expect(migrationName(more)).toBe("create_posts_and_more");
  });

  it("falls back to indexes, then to schema", () => {
    expect(migrationName('CREATE UNIQUE INDEX "User_email_key" ON "User"("email");')).toBe(
      "add_index_to_user",
    );
    expect(migrationName("SELECT 1;")).toBe("schema");
  });
});

describe("renaming generated migrations", () => {
  it("renames a Prisma migration folder", async () => {
    const root = await tempProject();
    const dir = join(root, "prisma/migrations/20261119120000_schema");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "migration.sql"), 'ALTER TABLE "User" ADD COLUMN "bio" TEXT;');
    const folder = prismaMigrations(root);
    expect(folder.rename("20261119120000_schema", false)).toBe("20261119120000_add_bio_to_user");
    expect(await readdir(join(root, "prisma/migrations"))).toEqual([
      "20261119120000_add_bio_to_user",
    ]);
  });

  it("renames a Drizzle migration and its journal entry", async () => {
    const root = await tempProject();
    await writeFile(join(root, "drizzle.config.ts"), 'export default { out: "./drizzle" };\n');
    await mkdir(join(root, "drizzle/meta"), { recursive: true });
    await writeFile(
      join(root, "drizzle/0001_oval_karma.sql"),
      'ALTER TABLE "users" ADD COLUMN "bio" text;',
    );
    const journal = {
      entries: [
        { idx: 0, tag: "0000_init" },
        { idx: 1, tag: "0001_oval_karma" },
      ],
    };
    await writeFile(join(root, "drizzle/meta/_journal.json"), JSON.stringify(journal));
    const folder = drizzleMigrations(root);
    expect(folder.list()).toEqual(["0000_init", "0001_oval_karma"]);
    expect(folder.rename("0001_oval_karma", false)).toBe("0001_add_bio_to_users");
    expect(await readdir(join(root, "drizzle"))).toContain("0001_add_bio_to_users.sql");
    const saved = JSON.parse(await readFile(join(root, "drizzle/meta/_journal.json"), "utf8"));
    expect(saved.entries[1].tag).toBe("0001_add_bio_to_users");
  });
});
