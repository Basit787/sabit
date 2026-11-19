import { serve } from "@hono/node-server";
import { corsOrigin, registerRoutes } from "@sabit/hono";
import { resolveRoutes } from "@sabit/router";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { routeTree } from "./sabit.route.ts";

/*
 * Every api.ts in src/routes is an endpoint: src/routes/users/api.ts → /users.
 * sabit.route.ts lists them all; `sabit dev` keeps it up to date.
 */
const routes = await resolveRoutes(routeTree);

const app = new Hono();
// One line per request (CORS preflights included): method, URL, status, time.
app.use(logger());
// Security headers on every response.
app.use(secureHeaders());
/*
 * Origins allowed to call the API: CORS_ORIGIN (comma-separated). Any origin in
 * development; production refuses to start without CORS_ORIGIN.
 */
app.use(cors({ origin: corsOrigin() }));
/*
 * File routes are rate limited (100 requests a minute per IP), read bodies up
 * to 100 KB and answer unexpected errors with a plain 500; the third argument
 * ({ rateLimit, bodyLimit, onError }) changes that.
 */
registerRoutes(app, routes);

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3000),
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
