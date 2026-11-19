# Contributing to sabit

Thanks for helping! This guide covers everything from setup to release. If
something here is unclear or out of date, that's a bug: please open an issue or
fix it in your PR.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before larger changes. It explains how
the routing engine and adapters fit together and why.

## Development setup

Requirements: **Node.js 22.18+** (24 recommended, see `.nvmrc`) and **pnpm**
(the version is pinned in `package.json`; `corepack enable` installs it).

```sh
git clone https://github.com/Basit787/backend-file-based-routing.git
cd sabit
pnpm install
pnpm test
```

Or use the Makefile shortcuts:

| Command        | What it does                                                                          |
| -------------- | ------------------------------------------------------------------------------------- |
| `make install` | Installs dependencies                                                                 |
| `make up`      | Installs, builds, then rebuilds packages in the background on change                  |
| `make down`    | Stops the background rebuild                                                          |
| `make clean`   | Stops everything, then removes builds, `node_modules/`, caches and the local registry |

No build step is needed for development. Each package exports its TypeScript
sources under the `@sabit/source` condition, which the TypeScript config
and Vitest use, so typechecking and tests always see the current sources of
every package.

## Workspace commands

| Command                                       | What it does                                             |
| --------------------------------------------- | -------------------------------------------------------- |
| `pnpm test`                                   | Runs every package's tests through Turborepo (cached)    |
| `pnpm typecheck`                              | Type-checks every package, including type-level tests    |
| `pnpm lint` / `pnpm lint:fix`                 | Biome lint + format check / apply fixes                  |
| `pnpm build`                                  | Compiles every package to `dist/` with `tsc`             |
| `pnpm turbo run test --filter=@sabit/express` | Runs one package's tests                                 |
| `pnpm vitest`                                 | Watch mode across all packages (root `vitest.config.ts`) |
| `pnpm changeset`                              | Records a release note for your change                   |

## Repository layout

```
packages/router/           @sabit/router: the engine (no framework dependencies)
packages/schema/           @sabit/schema: defineSchema for schema.ts files (uses Zod)
packages/adapters/<name>/  one package per framework
packages/adapters/common/  @sabit/adapter-common: what every adapter shares (errors, rate limit, body limit)
packages/cli/              sabit: the CLI, plus project starters in templates/
packages/create-sabit/     npm create sabit
tests/conformance/         behavior every adapter must match, plus its fixture app
```

Package boundaries are enforced, not just documented:

- `@sabit/router` must not import any npm package or framework, and only
  its `/fs` and `/node` entry points may import Node built-ins. A test
  (`packages/router/test/boundaries.test.ts`) fails otherwise.
- Adapters list their framework as a **peer dependency** and never depend on
  each other.

## Coding standards

- TypeScript in strict mode, ESM only. Import relative files with their `.ts`
  extension (`import { x } from "./x.ts"`); the compiler rewrites it to `.js`.
- Use only erasable TypeScript syntax (no `enum`, `namespace`, or constructor
  parameter properties) so sources run directly under Node's type stripping.
- No `any`. If a framework's types force a cast, keep it local and explain it.
- Errors users can hit at startup should be `RouteDefinitionError`s that name
  the file and suggest a fix. Collect all problems rather than throwing on the
  first one.
- Every exported function and type has a JSDoc comment.
- Biome formats and lints everything; run `pnpm lint:fix` before pushing.

## Tests

- Write tests alongside the change. Bug fixes start with a failing test.
- Router features: unit tests in `packages/router/test`. Type-level behavior
  goes in `types.test.ts` (checked by `pnpm typecheck`).
- Anything that changes request/response behavior must be covered in
  `tests/conformance/src/index.ts`, so all adapters are held to it.
- Adapter tests start the real framework and make real HTTP requests. Bind to
  `127.0.0.1` and port `0`.

## Branches and commits

- Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`.
- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(router): support optional catch-all routes`,
  `fix(fastify): keep app-level form parser`, `docs: explain route groups`.
  Scopes: `router`, `express`, `hono`, `fastify`, `nest`, `cli`, `conformance`, `ci`.

## Pull requests

1. Open an issue first for new features or API changes, so the design can be
   agreed before you invest time.
2. Keep PRs focused. Refactors and behavior changes go in separate PRs.
3. Fill in the PR template. CI must pass: lint, typecheck, tests on Node 22 and
   24 (plus Windows), build, and package contents.
4. A maintainer reviews within a few days. Squash-merge is used, so the PR title
   should be a good conventional commit message.

## Changesets

Every PR that changes a published package needs a changeset:

```sh
pnpm changeset
```

Pick the affected packages and a bump type (we're pre-1.0: breaking changes are
`minor`, everything else `patch`), and write one or two sentences for users.
Docs-only or test-only changes don't need one.

Releases are automated: merging to `main` opens or updates a "Version packages"
PR, and merging that PR publishes to npm from GitHub Actions with provenance.
Publishing uses npm trusted publishing; maintainers configure it per package on
npmjs.com, or set an `NPM_TOKEN` repository secret. Tokens never go in the
repository.

## Adding a framework adapter

1. Create `packages/adapters/<name>/` by copying an existing adapter's
   `package.json`, `tsconfig*.json` and `vitest.config.ts`. List the framework as
   a peer dependency and a pinned dev dependency.
2. Read the framework's routing source for its **installed** version, not just
   its docs. Find out: param and wildcard syntax, whether wildcard values are
   decoded and how they're stored, how HEAD and OPTIONS are handled, which body
   types it parses, and how errors reach its error handler.
3. Implement the contract from ARCHITECTURE.md §4. Use the engine's helpers
   (`formatPaths`, `createContext`, `executeRoute`, `fallbackMethods`) rather
   than reimplementing them. The Express, Hono and Fastify adapters are each
   about 120 lines.
4. Export a typed escape hatch (`get<Name>(ctx)`) for the native request/response.
5. In `test/<name>.test.ts`, call `runConformanceSuite("<name>", start)` where
   `start` boots the framework with the given routes. Run it twice if the
   framework supports mounting under a prefix. Add tests for anything
   framework-specific (native middleware, error handlers, the escape hatch).
6. Add the package to the README table and to `.github/ISSUE_TEMPLATE/bug_report.yml`.

If the conformance suite can't pass because of a genuine framework limitation,
discuss it in an issue before skipping a scenario. Matching behavior across
frameworks is the point of the project.

## Adding a routing feature

1. Propose it in an issue: the file convention, what URL it maps to, and how
   each supported framework can express it.
2. Parsing lives in `segments.ts`, compilation (middleware, conflicts, ordering)
   in `compile.ts`, matching in `matcher.ts`, and framework path output in
   `format.ts`. Extend the `Segment` union if the feature is a new kind of
   segment; the compiler will point at every `switch` that needs updating.
3. Update conflict detection and ordering, and add tests for both.
4. Add `ParamsOf` support and type tests if params are involved.
5. Add the convention to the conformance fixture and suite.
6. Document it in README.md and ARCHITECTURE.md §3.

## Code of conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.
