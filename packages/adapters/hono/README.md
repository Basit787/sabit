# @sabit/hono

[sabit](../../../README.md) file-based routing for **Hono 4**.

```ts
import { Hono } from "hono";
import { loadRoutes } from "@sabit/router/fs";
import { registerRoutes } from "@sabit/hono";

const app = registerRoutes(new Hono(), await loadRoutes(new URL("./routes", import.meta.url)));
export default app;
```

- Mount under a prefix with Hono's own `app.route("/api", registerRoutes(new Hono(), routes))`.
- Parses JSON, URL-encoded and `text/*` bodies. Other types (such as
  multipart) are left to you: use `getHono(ctx).req.parseBody()`.
- Errors other than `HttpError` propagate to `app.onError`.
- Hono always serves HEAD requests through GET routes; the adapter still uses a
  route's `HEAD` export when it has one.
- `@sabit/router/fs` needs Node.js. On runtimes without a filesystem, build
  the route list with `resolveRoutes` and static imports instead.
- `getHono(ctx)` returns the native `Context`.
