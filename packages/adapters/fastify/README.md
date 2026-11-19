# @sabit/fastify

[sabit](../../../README.md) file-based routing for **Fastify 5**.

```ts
import Fastify from "fastify";
import { loadRoutes } from "@sabit/router/fs";
import { fileRoutes } from "@sabit/fastify";

const app = Fastify();
await app.register(fileRoutes, {
  routes: await loadRoutes(new URL("./routes", import.meta.url)),
  prefix: "/api",
});
await app.listen({ port: 3000 });
```

- Registers one Fastify route per exported method, so `app.hasRoute`,
  `printRoutes` and Fastify hooks see them.
- Fastify parses JSON and `text/plain`. The plugin adds URL-encoded and
  `text/*` parsers inside its own encapsulated scope, unless the app already
  has them.
- Errors other than `HttpError` go to Fastify's error handler.
- `getFastify(ctx)` returns the native `{ request, reply }`.
