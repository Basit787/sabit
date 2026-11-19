import { defineConfig } from "vitest/config";

// Lets editors and `pnpm vitest` at the root run every package's tests at once.
// CI runs tests per package through Turborepo instead (`pnpm test`).
export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts", "packages/adapters/*/vitest.config.ts"],
  },
});
