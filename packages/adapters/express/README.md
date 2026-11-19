# @sabit/express

[sabit](../../../README.md) file-based routing for **Express 5**.

```ts
import express from "express";
import { loadRoutes } from "@sabit/router/fs";
import { createRouter } from "@sabit/express";

const app = express();
app.use("/api", createRouter(await loadRoutes(new URL("./routes", import.meta.url))));
app.listen(3000);
```

- `createRouter(routes, { bodyParser })` returns an `express.Router`. It parses
  JSON, URL-encoded and `text/*` bodies for file routes only (default limit
  `100kb`; `bodyParser: { limit: "1mb" }` to change it, `false` to disable).
  Bodies already parsed by app-level middleware are reused.
- Errors other than `HttpError` are passed to `next(err)`, so your Express error
  handlers see them.
- `getExpress(ctx)` returns the native `{ req, res }`.
