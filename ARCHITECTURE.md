# Architecture

This document describes how sabit is put together and why. Read it before
changing the routing engine, adding an adapter, or adding a package.

> Status markers: **[done]** is implemented and tested, **[planned]** is designed
> but not built yet. Nothing marked planned should be documented to users as
> available.

## 1. Goals and non-goals

sabit is a **file-based routing engine for backend frameworks**. The engine
turns a directory of route modules into a list of routes, and thin adapters
register that list with Express, Hono, Fastify or NestJS. The CLI and project
initializer exist to make the engine easy to adopt; they are not the product.

Goals:

- One routing convention and one handler contract that behave the same on every
  supported framework, verified by a shared conformance suite.
- The engine has zero framework dependencies and zero runtime npm dependencies.
- Native escape hatches: every handler can reach the underlying framework's
  request and response objects, and framework-native middleware keeps working.
- Type safety from the file path: route params are inferred from the path
  literal; bodies and queries are typed from optional validation schemas.

Non-goals (for now): an HTTP server of our own, an ORM or database layer, a
bundler, and a validation library. Validation is done through the
[Standard Schema](https://standardschema.dev) interface, so Zod, Valibot and
ArkType work without us depending on any of them.

## 2. Packages

```
packages/
  router/                @sabit/router     engine: conventions, discovery, matching, middleware, handler contract
  adapters/hono/         @sabit/hono       registers routes on a Hono app
  adapters/express/      @sabit/express    registers routes on an Express app/router
  adapters/fastify/      @sabit/fastify    registers routes on a Fastify instance (as a plugin)
  adapters/nest/         @sabit/nest       dynamic module that generates Nest controllers
  schema/                @sabit/schema           defineSchema: Mongoose-style body schemas (uses Zod)
  cli/                   sabit                   `sabit` CLI: init, add, dev, watch, generate, routes; starter templates
  create-sabit/          create-sabit            `npm create sabit`: runs `sabit init`
tests/
  conformance/           private: one scenario suite every adapter must pass
apps/docs/               documentation site                                                                    [planned]
examples/*               (empty) projects created with `sabit init` for local testing; not committed
```

### Deviations from the original brief, and why

- **No `core` or `shared` package.** The brief listed `core`, `router` and
  `shared`. Today there is no code that belongs in `core` but not in `router`,
  and no utility shared by packages that don't already depend on `router`.
  Creating them now would mean empty placeholder packages. If the CLI grows a
  config loader that adapters also need, that is the moment to extract one.
- **`create-sabit` instead of `create-app`.** `npm create <x>` resolves to
  the package named `create-<x>`, so the directory is named after the package.
- **Subpath exports instead of more packages.** `@sabit/router` has
  separate entry points so that runtime code never pulls in Node-only code:
  - `@sabit/router` — runtime: types, `createRoute`, `defineMiddleware`,
    `HttpError`, `reply`, `executeRoute`, route compilation and matching. Uses
    only web-standard globals, so it runs on Node, Bun, Deno and Workers.
  - `@sabit/router/fs` — Node-only: discovers and imports route files from
    disk.
  - `@sabit/router/node` — Node-only adapter helpers: writing an outcome to
    a `ServerResponse`, reading a raw text body. Shared by the Express and Nest
    adapters.
  - Route tree generation (`src/sabit.route.ts`) lives in the CLI (`packages/cli/src/codegen.ts`); it writes static imports of every route plus
    route type declarations, for bundlers and edge runtimes that cannot scan the
    filesystem at startup.

### Dependency rules

- `router` depends on nothing (except `@types/node` at dev time for `/fs`).
- Each adapter depends on `router` and lists its framework as a
  **peer dependency**. Adapters never depend on each other.
- `cli` depends on `router`; it never depends on an adapter. Framework-specific
  CLI behavior lives in project templates, not in CLI code.
- Nothing in `router` may import express, hono, fastify or @nestjs/*. A test in
  the router package enforces this by scanning its source imports.

## 3. Routing engine design

The engine is a pipeline of small pure stages. Each stage is exported and tested
on its own.

```
 routes dir ──scan──▶ RouteFile[] ──parse──▶ RouteSource[] ──compile──▶ CompiledRoute[]
                                                                  │
                                       import modules (fs loader) ┘──▶ ResolvedRoute[] ──▶ adapter.register()
```

### 3.1 Discovery (`/fs`, `scanRoutes`)

Walks the routes directory recursively and returns relative file paths. Rules:

- Route module extensions: `.ts .mts .cts .js .mjs .cjs` (`.d.ts` excluded).
- Not routes, so helpers can sit beside them: file names with a dot before the
  extension (`user.dto.ts`, `api.test.ts`, `types.d.ts`;
  dots inside `[...]` don't count) and anything starting with `_`.
- `api.<ext>` and `index.<ext>` serve their folder's own path.
- `middleware.<ext>` is a middleware file, not a route.

### 3.2 Parsing (`parseRoutePath`)

Each directory and file name becomes a segment:

| File name        | Segment kind       | URL contribution      | Param type               |
| ---------------- | ------------------ | --------------------- | ------------------------ |
| `index.ts`       | (none)             | nothing               |                          |
| `health.ts`      | static             | `/health`             |                          |
| `(public)/`      | group              | nothing               |                          |
| `[id].ts`        | dynamic            | `/:id`                | `string`                 |
| `[...slug].ts`   | catch-all          | one or more segments  | `string[]`               |
| `[[...slug]].ts` | optional catch-all | zero or more segments | `string[]` (maybe empty) |

Parse errors are thrown as `RouteDefinitionError` with the file path and a fix
suggestion. Invalid inputs include: partial brackets (`user-[id]`), param names
that aren't identifiers, catch-alls that aren't the last segment, duplicate
param names in one path, empty groups `()`, and static segments containing
characters that frameworks treat as syntax (`: * ? ( ) { } +`).

### 3.3 Compilation (`compileRoutes`)

Turns parsed sources into `CompiledRoute`s:

- **Pattern**: the canonical, framework-neutral path, e.g. `/users/[id]/posts`.
  This string is the route's identity everywhere (types, logs, conflicts).
- **Middleware chain**: every `middleware.*` file in an ancestor directory
  (including group directories), outermost first. Middleware inside `(group)/`
  applies only to routes inside that group, which is how route groups
  provide shared middleware without changing URLs.
- **Conflict detection**: two sources conflict when their _shapes_ match after
  replacing param names, e.g. `users.ts` vs `users/index.ts`, `(a)/login.ts` vs
  `(b)/login.ts`, `[id].ts` vs `[slug].ts` in the same folder, or
  `docs/index.ts` vs `docs/[[...slug]].ts` (both claim `/docs`). Conflicts are
  reported together, not one at a time.
- **Ordering**: routes are sorted by specificity, segment by segment: static >
  dynamic > catch-all > optional catch-all, ties broken by pattern string.
  Express and Hono match in registration order; Fastify ranks routes itself.
  Registering in specificity order makes all three agree (`/users/new` always
  beats `/users/[id]`).

### 3.4 Module contract

A route module exports any of `GET POST PUT PATCH DELETE OPTIONS HEAD` and,
optionally:

- `middleware`: route-level middleware that runs after inherited middleware.

Any other export is ignored, so data and helpers can live in route files (the
generated `[id]/api.ts` imports its sample data from `../api.ts`).

Two more file kinds sit beside routes:

- `schema.ts` in a routes folder: its default export (any Standard Schema)
  checks POST and PUT bodies of routes in that folder and below, PATCH bodies
  with `partial()` when available. The nearest one wins (3.7).
- `src/middleware.ts` (the app middleware, passed as `appMiddleware`): runs
  before every route, before folder middleware. `guard({ rules, user })` builds
  it: requests matching a rule need a user (401) with the rule's role (403).

Validation runs innermost, after all middleware, so auth answers before a
body is inspected. `withMiddleware(...mw)(handler)` wraps a single handler;
it records what it wraps so validation still runs inside it.
A module that exports no methods is an error (it's almost always a typo such
as `export function get`); lowercase method names get a targeted hint.

A middleware module's default export is a middleware or an array of them.

### 3.5 Handler contract

```ts
type Handler = (ctx: RouteContext) => unknown | Promise<unknown>;

interface RouteContext<Params, Query, Body> {
  method: HttpMethod;
  path: string; // pathname actually requested
  route: string; // matched pattern, e.g. "/users/[id]"
  params: Params; // inferred from the pattern
  query: Query; // Record<string, string | string[]> unless validated
  body: Body; // parsed JSON / form / text, unknown unless validated
  headers: Headers; // web-standard Headers
  state: State; // per-request bag shared with middleware (augmentable)
  raw: Platform; // escape hatch: framework request/response (augmentable)
}
```

Return values are normalized identically by every adapter:

| Handler returns                 | Response                                       |
| ------------------------------- | ---------------------------------------------- |
| `undefined`                     | `204` with empty body                          |
| string                          | `200 text/plain; charset=utf-8`                |
| other JSON-serializable value   | `200 application/json`                         |
| `reply(status, body, headers?)` | given status/headers; body serialized as above |
| web `Response`                  | passed through unchanged                       |

Errors: `throw new HttpError(404, "User not found")` produces a JSON error
response `{ "error": { "status": 404, "message": "User not found" } }` on every
framework. Any other thrown value is rethrown into the framework's own error
handling (Express `next(err)`, Fastify error handler, Hono `onError`, Nest
exception filters), so existing error tooling keeps working.

Unhandled methods on a matched path return `405` with an `Allow` header.

### 3.6 Middleware

Middleware is framework-neutral and uses the onion model:

```ts
type Middleware = (ctx: RouteContext, next: () => Promise<unknown>) => unknown;
```

Order for a request to `routes/users/[id].ts`:

```
routes/middleware.ts → routes/users/middleware.ts → [id].ts `middleware` export → handler
```

A middleware can short-circuit by returning without calling `next()`, can
inspect or replace the result of `await next()`, and can share data via
`ctx.state`. Calling `next()` twice throws. The composition function
(`composeMiddleware`) is exported and tested independently of any framework.

Framework-native middleware (e.g. `app.use(cors())`, Nest guards) still runs
before sabit middleware because adapters register ordinary routes.

### 3.7 Validation

`createRoute(pattern).handle({ body, query, params }, handler)` accepts any
Standard Schema. The engine validates before calling the handler, passes the
schema _output_ (coerced/transformed values) to the handler, and responds `400`
with the issues on failure. The Standard Schema interface is vendored as types
(as its spec recommends), so there is no runtime dependency.

`@sabit/schema`'s `defineSchema({ name: { type: String, required: true } })`
is the schema users write in `schema.ts`: Mongoose-style field definitions
(typed for autocomplete) compiled to Zod; `Infer<typeof schema>` gives the
body type. It lives in its own package so the router keeps zero dependencies.

### 3.8 Type safety

- `ParamsOf<"/users/[id]/files/[...path]">` is `{ id: string; path: string[] }`,
  computed at the type level from the pattern literal.
- `createRoute("/users/[id]")` returns a typed builder. At startup the loader
  checks that the literal matches the file's real pattern and fails with a
  clear message if a file was moved without updating it.
- `State` and `Platform` are customized through a `Register` interface that
  apps augment with `declare module`, the same pattern TanStack Router uses.
- `RouteContext<P>` is a type alias over the `RequestContext` interface. The
  alias resolves the pattern to a params type first, which lets TypeScript see
  that a route-specific context is assignable to a plain `RouteContext` (shared
  helpers can take any context). Declaring `RouteContext` as an interface with a
  conditional params type made it invariant.
- [planned] `codegen` emits a route map type so the CLI can verify every
  `createRoute` literal at typecheck time and a typed client can be derived.

## 4. Adapter contract

The engine exposes everything an adapter needs, so adapters stay small (roughly
100–200 lines) and contain only framework glue:

```ts
// provided by @sabit/router
formatPaths(route, dialect): string[]                    // canonical pattern -> framework path(s)
createContext(route, init, catchAllKey?): RouteContext   // builds the neutral context
executeRoute(route, method, ctx): Promise<RouteOutcome>  // middleware + handler + normalization
fallbackMethods(route): HttpMethod[]                     // methods to register for 405 / OPTIONS
```

Every adapter must:

1. Accept already-resolved routes (`ResolvedRoute[]`) so it never touches the
   filesystem. Loading from disk is `@sabit/router/fs`'s job.
2. Translate the canonical pattern with `formatPaths` and a dialect describing the
   framework's syntax for params and catch-alls. Optional catch-alls become two
   registrations (with and without the tail) so no framework needs optional
   wildcard support.
3. Register handlers in route order, HEAD before GET (Fastify auto-creates
   HEAD for GET unless one exists), then register `fallbackMethods(route)` so the
   most specific route answers every method on its path (405 / 204).
   Pass the **request's** method to `executeRoute`, not the registered one:
   Express and Hono route HEAD to GET handlers, and `executeRoute` then picks an
   explicit HEAD export if there is one. (Hono always dispatches HEAD to GET
   routes, `hono-base.js`, so this is the only way HEAD exports work there.)
4. Build the context: method, path, decoded raw params, URL query string,
   headers, parsed body, and a `raw` object with the native request/response.
5. Write the `RouteOutcome` (status, headers, body as string, bytes, stream, or
   null) using native response APIs.
6. Rethrow non-`HttpError` errors into the framework's error pipeline.
7. Pass `tests/conformance`.

### NestJS

Nest is not forced through the same shape. Its adapter is a dynamic module
(`FileRoutesModule.forRoot({ routes })`) that, at module creation time,
generates one **real Nest controller class per route file** and applies Nest's
own decorators to it programmatically (`Controller`, `Get`, `Post`, …,
`UseGuards`, `UseInterceptors`). Consequences:

- Routes appear in Nest's router, logs, and lifecycle like any controller.
- Guards and interceptors (global, module-level, or exported per route file as
  `guards` / `interceptors`) run in Nest's normal order.
- Route files can export `metadata` (applied with `SetMetadata`), so guards that
  read metadata through `Reflector` work unchanged.
- Handlers reach DI through `getNest(ctx).resolve(token)`, backed by
  `ModuleRef`, because a plain function cannot use constructor injection.
- **Responses use Nest's library-specific mode (`@Res()`).** With
  `@Res({ passthrough: true })`, Nest's `RouterExecutionContext` passes its
  static status (201 for POST, or `@HttpCode`) to `reply()` after the handler
  runs, overwriting any status the handler set. That makes `reply(201, …)`,
  204-for-undefined and `Response` passthrough impossible. Trade-off:
  interceptors run before and after handlers but cannot replace the response
  body. Errors other than `HttpError` (including guard rejections) still go
  through Nest's exception filters.
- Pipes apply to decorated parameters, which file routes don't have; validation
  uses Standard Schema instead. This is documented rather than emulated.
- Only `@nestjs/platform-express` is supported and tested. On other platforms
  the adapter throws a clear error at the first request.

## 5. Technical risks

| Risk                                                                                                                                                                        | Mitigation                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Path syntax differs per framework and per major version (Express 5 uses path-to-regexp v8 with `*name` wildcards; Fastify wildcards are unnamed `*`; Hono uses `:name{.+}`) | Engine owns the canonical pattern; each adapter declares a dialect; conformance suite runs the same catch-all and param-decoding scenarios on every adapter. |
| HEAD/OPTIONS auto-handling differs (Express answers HEAD via GET, Fastify adds HEAD routes)                                                                                 | Register order rules above, plus conformance scenarios for explicit HEAD.                                                                                    |
| Body parsing differs (Express needs a parser, Fastify parses JSON, Hono is lazy)                                                                                            | Adapters parse JSON/form/text consistently; Express adapter installs parsers on its own router only, never globally.                                         |
| Nest needs decorators, DI and metadata at class-definition time                                                                                                             | Generated controllers + programmatic decorators; DI through `ModuleRef`; no decorator syntax in the adapter source.                                          |
| Importing `.ts` route files at runtime                                                                                                                                      | Node 24 strips types natively for erasable syntax; production uses compiled `.js`; codegen manifest removes runtime scanning entirely.                       |
| `createRoute` literals drifting from file locations                                                                                                                         | Startup check now; typecheck-time check via codegen later.                                                                                                   |
| Publishing needs the `@sabit` npm organization                                                                                                                              | `sabit` and `create-sabit` were free on npm on 2026-11-18; create the free `sabit` org on npmjs.com before the first publish.                                |

## 6. Roadmap

Milestones 1–4 are **[done]**, 5 is mostly done (no `typecheck` command yet), 6 is **[planned]**.

1. **Foundation** — pnpm + Turborepo, strict TS, Biome, Vitest, Changesets,
   MIT license and community files, CI.
2. **Routing core** — discovery, parsing, conflicts, ordering, matching,
   middleware composition, handler contract, validation, fs loader, tests.
3. **Adapters** — Hono, Express, Fastify, Nest, plus the conformance suite.
4. **CLI** — `create-sabit` interactive initializer and templates.
5. **DX** — `sabit routes|generate|dev|build|typecheck`, codegen,
   file watching.
6. **Production readiness** — docs site, examples, release automation.
