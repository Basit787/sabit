import { defaultExclude, defineProject } from "vitest/config";

/**
 * Resolve workspace packages to their TypeScript sources (see the
 * "@sabit/source" export condition in each package.json), so tests never
 * need a build first. The remaining entries are Vite's default server conditions.
 */
const conditions = ["@sabit/source", "module", "node", "development|production"];

export default defineProject({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: ["@sabit/source"] } },
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: [...defaultExclude, "**/fixtures/**"],
    restoreMocks: true,
  },
});
