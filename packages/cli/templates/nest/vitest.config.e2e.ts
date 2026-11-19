import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
    include: ['**/*.e2e-spec.ts'],
  },
});
