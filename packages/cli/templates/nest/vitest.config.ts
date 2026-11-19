import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  /*
   * Resolves the path aliases declared in tsconfig.json, including the ones
   * added by `nest g library`. Requires Vite 8, which ships this option.
   */
  resolve: {
    tsconfigPaths: true,
    // #src/ runs from dist/ in the app (package.json "imports"); tests read src/.
    alias: {
      '#src': fileURLToPath(new URL('./src', import.meta.url)),
      '#test': fileURLToPath(new URL('./test', import.meta.url)),
    },
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // The starter has no unit tests yet; add *.spec.ts files next to your code.
    passWithNoTests: true,
  },
});
