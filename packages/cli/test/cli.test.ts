import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/index.ts";
import { captureOutput, tempProject } from "./helpers.ts";

describe("sabit", () => {
  it("prints help listing every command", async () => {
    const out = captureOutput();
    expect(await run([], { out })).toBe(0);
    const help = out.lines.join("\n");
    for (const name of ["init", "dev", "add", "routes", "generate"]) expect(help).toContain(name);
  });

  it("prints command help", async () => {
    const out = captureOutput();
    expect(await run(["add", "--help"], { out })).toBe(0);
    expect(out.lines[0]).toMatch(/^Usage: sabit add <resource/);
  });

  it("rejects unknown commands and options", async () => {
    const out = captureOutput();
    expect(await run(["deploy"], { out })).toBe(1);
    expect(out.errors[0]).toMatch(/Unknown command "deploy"/);
    expect(await run(["add", "users", "--nope"], { out })).toBe(1);
    expect(out.errors[1]).toMatch(/Unknown option '--nope'/);
  });

  describe("add + routes", () => {
    it("scaffolds resources into src/routes and lists them", async () => {
      const cwd = await tempProject();
      const out = captureOutput();
      expect(await run(["add", "users", "posts"], { cwd, out })).toBe(0);
      expect(out.lines).toEqual([
        "  created  src/routes/users/api.ts  →  GET, POST /users",
        "  created  src/routes/users/[id]/api.ts  →  GET, PUT, PATCH, DELETE /users/:id",
        "  created  src/routes/users/schema.ts",
        "  created  src/routes/posts/api.ts  →  GET, POST /posts",
        "  created  src/routes/posts/[id]/api.ts  →  GET, PUT, PATCH, DELETE /posts/:id",
        "  created  src/routes/posts/schema.ts",
      ]);

      const list = captureOutput();
      expect(await run(["routes"], { cwd, out: list })).toBe(0);
      expect(list.lines).toEqual([
        "METHODS                   PATH         FILE",
        "GET, POST                 /posts       posts/api.ts",
        "GET, PUT, PATCH, DELETE   /posts/:id   posts/[id]/api.ts",
        "GET, POST                 /users       users/api.ts",
        "GET, PUT, PATCH, DELETE   /users/:id   users/[id]/api.ts",
        "",
        "4 routes in src/routes",
      ]);
    });

    it("accepts generate route as the long form", async () => {
      const cwd = await tempProject();
      const out = captureOutput();
      expect(await run(["generate", "route", "orders", "--no-item"], { cwd, out })).toBe(0);
      expect(out.lines).toEqual([
        "  created  src/routes/orders/api.ts  →  GET, POST /orders",
        "  created  src/routes/orders/schema.ts",
      ]);
    });

    it("explains invalid names without a stack trace", async () => {
      const cwd = await tempProject();
      const out = captureOutput();
      expect(await run(["add", "user-[id]"], { cwd, out })).toBe(1);
      expect(out.errors[0]).toMatch(/mixes static text and a dynamic segment/);
    });

    it("reports route problems from routes", async () => {
      const cwd = await tempProject();
      await run(["add", "users"], { cwd, out: captureOutput() });
      await writeFile(join(cwd, "src/routes/users/index.ts"), "export const GET = () => 1;\n");
      const out = captureOutput();
      expect(await run(["routes"], { cwd, out })).toBe(1);
      expect(out.errors[0]).toMatch(/conflicts with/);
    });
  });

  describe("init", () => {
    const expectedFiles = {
      express: [
        "src/index.ts",
        "src/routes/api.ts",
        "eslint.config.ts",
        ".prettierrc",
        ".gitignore",
      ],
      hono: ["src/index.ts", "src/routes/api.ts", "eslint.config.ts", ".prettierrc", ".gitignore"],
      fastify: [
        "src/index.ts",
        "src/routes/api.ts",
        "eslint.config.ts",
        ".prettierrc",
        ".gitignore",
      ],
      nest: [
        "src/main.ts",
        "src/middleware.ts",
        "src/app.module.ts",
        "src/sabit.route.ts",
        "src/routes/api.ts",
        "test/app.e2e-spec.ts",
        "nest-cli.json",
        "vitest.config.ts",
        ".gitignore",
        ".vscode/tasks.json",
      ],
    } as const;

    it.each(["express", "hono", "fastify", "nest"] as const)(
      "creates the %s starter",
      async (framework) => {
        const cwd = await tempProject();
        const out = captureOutput();
        expect(await run(["init", "my-app", "--framework", framework], { cwd, out })).toBe(0);
        const dir = join(cwd, "my-app");

        for (const file of expectedFiles[framework])
          expect(existsSync(join(dir, file)), file).toBe(true);
        expect(existsSync(join(dir, "_gitignore"))).toBe(false);

        const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
        expect(pkg.name).toBe("my-app");
        expect(pkg.type).toBe("module");
        expect(pkg.scripts.dev).toMatch(/^sabit dev/);
        expect(pkg.dependencies[`@sabit/${framework}`]).toBe("workspace:*");
        expect(JSON.stringify(pkg)).not.toContain("{{");

        expect(out.lines).toContain("  created  src/routes/users/api.ts  →  GET, POST /users");
        expect(out.lines).toContain("  created  src/routes/users/schema.ts");
        expect(out.lines).toContain("  created  src/middleware.ts");
      },
    );

    it("wires file routes into the Nest AppModule and runs nest through dev", async () => {
      const cwd = await tempProject();
      await run(["init", "--framework", "nest"], { cwd, out: captureOutput() });
      const appModule = await readFile(join(cwd, "src/app.module.ts"), "utf8");
      expect(appModule).toContain("FileRoutesModule.forRoot");
      const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
      expect(pkg.scripts.dev).toBe('sabit dev --run "nest start --watch"');
    });

    it("replaces the default linter with Biome", async () => {
      const cwd = await tempProject();
      await run(["init", "--framework", "express", "--lint", "biome"], {
        cwd,
        out: captureOutput(),
      });
      expect(existsSync(join(cwd, "biome.json"))).toBe(true);
      expect(existsSync(join(cwd, "eslint.config.ts"))).toBe(false);
      expect(existsSync(join(cwd, ".prettierrc"))).toBe(false);
      const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
      expect(pkg.scripts.lint).toBe("biome check .");
      expect(pkg.devDependencies["@biomejs/biome"]).toMatch(/^\^2\./);
      expect(pkg.devDependencies.eslint).toBeUndefined();
      expect(pkg.devDependencies.prettier).toBeUndefined();
    });

    it("enables parameter decorators when Nest uses Biome", async () => {
      const cwd = await tempProject();
      await run(["init", "--framework", "nest", "--lint", "biome"], { cwd, out: captureOutput() });
      const biome = JSON.parse(await readFile(join(cwd, "biome.json"), "utf8"));
      expect(biome.javascript.parser.unsafeParameterDecoratorsEnabled).toBe(true);
      expect(existsSync(join(cwd, ".oxlintrc.json"))).toBe(false);
      const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
      expect(pkg.devDependencies.oxlint).toBeUndefined();
    });

    it("can skip linting entirely", async () => {
      const cwd = await tempProject();
      await run(["init", "--framework", "hono", "--lint", "none"], { cwd, out: captureOutput() });
      const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
      expect(pkg.scripts.lint).toBeUndefined();
      expect(pkg.scripts.format).toBeUndefined();
      expect(existsSync(join(cwd, "biome.json"))).toBe(false);
    });

    it("rejects unknown package managers", async () => {
      const cwd = await tempProject();
      const out = captureOutput();
      expect(await run(["init", "--framework", "hono", "--pm", "deno"], { cwd, out })).toBe(1);
      expect(out.errors[0]).toMatch(/Unknown package manager "deno"/);
    });

    it("rejects unknown linters", async () => {
      const cwd = await tempProject();
      const out = captureOutput();
      expect(await run(["init", "--framework", "hono", "--lint", "tslint"], { cwd, out })).toBe(1);
      expect(out.errors[0]).toMatch(/Unknown --lint "tslint"/);
    });

    it("needs --framework when it can't prompt", async () => {
      const cwd = await tempProject();
      const out = captureOutput();
      expect(await run(["init"], { cwd, out, interactive: false })).toBe(1);
      expect(out.errors[0]).toMatch(/--framework/);
    });

    it("keeps existing files and merges into an existing package.json", async () => {
      const cwd = await tempProject();
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({ name: "mine", type: "module", scripts: { dev: "my-dev" } }),
      );
      await run(["init", "--framework", "hono"], { cwd, out: captureOutput() });
      const out = captureOutput();
      expect(await run(["init", "--framework", "express"], { cwd, out })).toBe(0);

      expect(await readFile(join(cwd, "src/index.ts"), "utf8")).toContain("hono");
      const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
      expect(pkg.name).toBe("mine");
      expect(pkg.scripts.dev).toBe("my-dev");
      expect(Object.keys(pkg.dependencies)).toEqual(
        expect.arrayContaining(["@sabit/hono", "@sabit/express", "express", "hono"]),
      );
      expect(out.lines).toContain("  exists   src/routes/users/api.ts  (left unchanged)");
    });
  });

  describe("dev", () => {
    it("explains a missing entry", async () => {
      const cwd = await tempProject();
      const out = captureOutput();
      expect(await run(["dev", "--no-scaffold"], { cwd, out })).toBe(1);
      expect(out.errors[0]).toMatch(/looked for src\/index.ts, src\/server.ts, src\/main.ts/);
    });

    it("runs a custom command with --run and returns its exit code", async () => {
      const cwd = await tempProject();
      const out = captureOutput();
      const code = await run(["dev", "--no-scaffold", "--run", 'node -e "process.exit(3)"'], {
        cwd,
        out,
      });
      expect(code).toBe(3);
    });
  });
});
