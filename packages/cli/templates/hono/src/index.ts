import { serve } from "@hono/node-server";
import { registerRoutes } from "@sabit/hono";
import { resolveRoutes } from "@sabit/router";
import { Hono } from "hono";
import { routeTree } from "./sabit.route.ts";

// Every api.ts in src/routes is an endpoint: src/routes/users/api.ts → /users.
// sabit.route.ts lists them all; `sabit dev` keeps it up to date.
const routes = await resolveRoutes(routeTree);

const app = registerRoutes(new Hono(), routes);

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3000),
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
