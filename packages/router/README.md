# @sabit/router

The framework-agnostic engine behind [sabit](../../README.md): file
conventions, route discovery, conflict detection, precedence, middleware
composition, the handler contract and validation. Zero runtime dependencies.

You normally use it together with an adapter (`@sabit/express`,
`@sabit/hono`, `@sabit/fastify` or `@sabit/nest`).

## Entry points

| Import               | Contents                                                                                                             | Runtime             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `@sabit/router`      | `RouteContext`, `createRoute`, `defineMiddleware`, `HttpError`, `reply`, route compilation and matching, adapter SDK | any (web APIs only) |
| `@sabit/router/fs`   | `loadRoutes(dir)`, `scanRoutes(dir)`                                                                                 | Node.js             |
| `@sabit/router/node` | helpers for adapters built on Node's `http` module                                                                   | Node.js             |

## Folder schemas and app middleware

- A `schema.ts` in a routes folder default-exports a schema (any Standard
  Schema: `defineSchema` from `@sabit/schema`, Zod, Valibot...). POST and PUT
  bodies of routes in that folder and below must match it; PATCH bodies are
  checked with its `partial()` when it has one.
- `resolveRoutes({ ..., appMiddleware })` runs one middleware (the app's
  `src/middleware.ts`) before every route. `guard()` builds it from rules:

```ts
import { guard } from "@sabit/router";

export default guard({
  rules: [
    { path: "/**", methods: ["POST", "PUT", "PATCH", "DELETE"] },
    { path: "/admin/**", role: "admin" },
  ],
  user: (ctx) => verify(ctx.headers.get("authorization")), // { id, role } or undefined
});
```

## Loading without the filesystem

`loadRoutes` scans a directory and imports each file. If your environment can't
scan at runtime (bundlers, edge runtimes), pass modules to `resolveRoutes`
yourself:

```ts
import { resolveRoutes } from "@sabit/router";

const routes = await resolveRoutes({
  routes: [
    { file: "index.ts", load: () => import("./routes/index.ts") },
    { file: "users/[id].ts", load: () => import("./routes/users/[id].ts") },
  ],
  middleware: [{ file: "middleware.ts", load: () => import("./routes/middleware.ts") }],
});
```

`file` is the path relative to the routes directory; it determines the URL.

## Inspecting routes

```ts
import { createMatcher } from "@sabit/router";

const match = createMatcher(routes);
match("/users/42"); // { route: { pattern: "/users/[id]", ... }, params: { id: "42" } }
```

See the [main README](../../README.md) for conventions and handler behavior,
and [ARCHITECTURE.md](../../ARCHITECTURE.md) for how adapters use the SDK.
