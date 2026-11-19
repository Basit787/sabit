import { existsSync } from "node:fs";
import { defineConfig } from "tsup";

/*
 * \`npm run build\` bundles the app into dist/, resolving the #src/ imports.
 * tsc only type-checks (see tsconfig.json: noEmit).
 */
export default defineConfig({
  entry: [
    "src/index.ts",
    // Kysely migrations run from dist/ in production, so they are built too.
    ...(existsSync("src/db/migrate.ts") ? ["src/db/migrate.ts", "src/db/migrations/*.ts"] : []),
  ],
  format: "esm",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
});
