# New adapter / CLI command / template — quote as `S2`

Reference set: `packages/adapters/hono/` (adapter),
`packages/cli/src/commands/routes.ts` (command), `packages/cli/templates/hono/`
(template).

### S1 Adapter files
`packages/adapters/<name>/` with `package.json` (framework as peer + pinned dev
dependency, `@sabit/router` `workspace:^`), `tsconfig.json`,
`tsconfig.build.json`, `vitest.config.ts`, `src/index.ts`,
`test/<name>.test.ts`, `README.md`. Copy them from an existing adapter. Why:
scripts, exports and the source condition must match (`C6`).

### S2 Adapter shape
```ts
export const <name>Dialect: PathDialect = { param: (n) => `:${n}`, catchAll: (n) => `*${n}` };

export function registerRoutes(app: App, routes: readonly ResolvedRoute[]) {
  for (const route of routes) {
    for (const path of formatPaths(route, <name>Dialect)) {
      // route.methods (HEAD before GET), then fallbackMethods(route)
    }
  }
}

export function get<Name>(ctx: RouteContext) {
  if (ctx.raw.framework !== "<name>") throw new Error(`get<Name>() called for ${ctx.raw.framework}`);
}
```
Why: every adapter exposes a dialect, a register function and a typed escape hatch.

### S3 Adapter test
`runConformanceSuite("<name>", start)` from `@sabit/conformance`, binding
`127.0.0.1` port `0`; a second run when the framework can mount under a prefix;
then framework-specific cases (native middleware, error handler, escape hatch).
Why: `C3`.

### S4 CLI command
One module in `packages/cli/src/commands/` exporting a `Command`
(`name`, `summary`, `usage`, `options`, `run`), added to the list in
`commands/index.ts`. `run` returns an exit code; user errors print one line via
`out.error` (or throw `UsageError`/`RouteDefinitionError`). Why: `cli.ts`
builds help and parsing from the list.

### S5 CLI tests
`packages/cli/test/`: drive `run([...], { cwd, out: captureOutput() })` with
`tempProject()` from `test/helpers.ts` (inside the package, so generated files
resolve `@sabit/router`). Why: `os.tmpdir()` projects can't import the packages.

### S6 New framework template
`packages/cli/templates/<id>/` copied from the framework's official starter,
wired to `src/sabit.route.ts`, plus an entry in `FRAMEWORKS`
(`src/frameworks.ts`) and the `init` tests' file list. Verify per `C9`.

### S7 Formatting and extras
2 spaces, double quotes, semicolons, lines ≤ 100 (Biome). No new dependency,
package or README unless asked. Why: `W3`.
