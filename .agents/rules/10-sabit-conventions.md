# sabit conventions — quote as `C2`

### C1 Package boundaries
`packages/router` (`@sabit/router`) imports no npm package or framework; only
its `src/fs` and `src/node` entry points may import `node:*`. Adapters in
`packages/adapters/<name>` list their framework as a peer dependency and never
import each other. `packages/cli` (`sabit`) depends on the router, never on an
adapter. Why: `packages/router/test/boundaries.test.ts` fails the build.

### C2 Adapters are glue only
An adapter uses `formatPaths`, `createContext`, `executeRoute` and
`fallbackMethods` from the router; routing, params, middleware, errors and
response shaping live in the router. Pass the request's method to
`executeRoute`, not the registered one. Why: the same behavior on every
framework is the product (ARCHITECTURE.md §4).

### C3 Behavior changes go through the conformance suite
Anything that changes a request or response goes in
`tests/conformance/src/index.ts` (fixture app in `tests/conformance/routes/`),
which every adapter runs. Why: an adapter-only test lets the frameworks drift.

### C4 Verify framework APIs in the installed source
Path syntax, wildcards, HEAD/OPTIONS, body parsing and error flow differ per
framework and version: read `node_modules/<framework>` before relying on one.
Why: Hono routes HEAD to GET, Fastify's wildcard is `*`, Nest overwrites status
in passthrough mode — none of it was in the docs.

### C5 Erasable TypeScript, `.ts` imports
Relative imports carry `.ts` (rewritten to `.js` on build); no `enum`,
`namespace` or constructor parameter properties (`erasableSyntaxOnly`); no
`any` (Biome `noExplicitAny`). Why: sources run under Node's type stripping and
Vitest without a build.

### C6 Source condition, no build for dev
Each package exports `@sabit/source` → `src/`; `tsconfig.base.json` and
`vitest.shared.ts` resolve it, so typecheck and tests read sources. Only the
CLI's `dist/bin.js` and plain-Node runs need `pnpm build`. Why: tests that need
a build first hide stale-output bugs.

### C7 Startup errors list every problem
Problems with route files are `RouteDefinitionError`s naming the file, with a
`hint` when there's an obvious fix, collected rather than thrown one by one.
Why: users fix their tree in one pass.

### C8 Checks
`pnpm typecheck`, `pnpm test`, `pnpm lint` (Biome; `pnpm lint:fix` rewrites);
one package: `pnpm turbo run test --filter=<name>`. Run them once at the end;
silent on pass. Why: Turborepo caches them per package, so reruns are cheap.

### C9 CLI templates are real projects
`packages/cli/templates/<framework>/` mirrors the framework's official starter;
`{{name}}`/`{{kit}}` are filled in and `_gitignore` becomes `.gitignore`. Biome
skips this folder (each starter has its own formatter). A template change is
verified by creating a project with the built CLI and running its own
`lint`, `build` and `dev`. Why: unit tests can't catch a starter that doesn't
install or lint (TS 7 vs typescript-eslint, missing `jiti`).

### C10 Never touch build output
Don't read, grep or edit `dist/`, `.turbo/`, `coverage/` or `.local-registry/`.
Why: compiled copies double every search and can be stale.

### C11 Comments: two lines max
Only the non-obvious (a framework quirk, why a guard exists), above the code.
Exported functions and types keep a short JSDoc. Why: these files are the docs
contributors read.

### C12 Changesets for published packages
A change to a published package (`@sabit/*`, `sabit`, `create-sabit`) adds a
`.changeset/*.md` (pre-1.0: breaking = minor). Why: releases are built from them.
