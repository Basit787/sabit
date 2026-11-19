# @sabit/nest

[sabit](../../../README.md) file-based routing for **NestJS 12** on
`@nestjs/platform-express`.

```ts
import { Module } from "@nestjs/common";
import { loadRoutes } from "@sabit/router/fs";
import { FileRoutesModule } from "@sabit/nest";

@Module({
  imports: [
    FileRoutesModule.forRoot({
      routes: loadRoutes(new URL("./routes", import.meta.url)), // a promise is fine
      path: "api",
      guards: [AuthGuard],
      providers: [UsersService],
    }),
  ],
})
export class AppModule {}
```

## How it fits Nest

Each route file becomes a **real Nest controller**, generated at startup with
Nest's own decorators. Routes appear in Nest's route log, and Nest's lifecycle
applies as usual.

| Nest feature         | File routes                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| Guards               | Global, `forRoot({ guards })`, or `export const guards = [...]` in a route file |
| Interceptors         | Global, `forRoot({ interceptors })`, or `export const interceptors = [...]`     |
| `Reflector` metadata | `export const metadata = { roles: ["admin"] }` (applied with `SetMetadata`)     |
| Dependency injection | `getNest(ctx).resolve(UsersService)`                                            |
| Exception filters    | Receive every error except `HttpError` (including guard rejections)             |
| Pipes                | Not applicable (no decorated parameters); use `createRoute` validation          |

```ts
// routes/users/index.ts
import type { RouteContext } from "@sabit/router";
import { getNest } from "@sabit/nest";
import { UsersService } from "../../lib/users.service.ts";

export const metadata = { roles: ["admin"] };

export function GET(ctx: RouteContext) {
  return getNest(ctx).resolve(UsersService).findAll();
}
```

## Trade-off: interceptors can't replace the response body

sabit writes responses itself (Nest's library-specific `@Res()` mode).
That's required for `reply(201, …)`, `204` for `undefined`, and web `Response`
passthrough: in Nest's passthrough mode, Nest overwrites the status after the
handler runs with the route's static status (`201` for every POST). As a
result, interceptors run before and after file-route handlers (logging, timing,
headers) but can't transform the returned value. Use sabit middleware to
transform results.

## Limits

- Only `@nestjs/platform-express` is supported. Fastify-platform apps can use
  `@sabit/fastify` directly.
- `getNest(ctx)` returns `{ request, response, moduleRef, resolve }`.
