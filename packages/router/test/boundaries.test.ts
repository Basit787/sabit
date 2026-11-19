import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(e.parentPath, e.name));
}

function importsOf(code: string): string[] {
  return [...code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1] as string);
}

describe("package boundaries", () => {
  it("never imports a web framework or any npm package", async () => {
    for (const file of await sourceFiles(srcDir)) {
      const external = importsOf(await readFile(file, "utf8")).filter(
        (spec) => !spec.startsWith(".") && !spec.startsWith("node:"),
      );
      expect(external, file).toEqual([]);
    }
  });

  it("only uses Node built-ins in the /fs and /node entry points", async () => {
    for (const file of await sourceFiles(srcDir)) {
      if (file.includes(join("src", "fs")) || file.includes(join("src", "node"))) continue;
      const nodeImports = importsOf(await readFile(file, "utf8")).filter((s) =>
        s.startsWith("node:"),
      );
      expect(nodeImports, file).toEqual([]);
    }
  });
});
