import { corsOrigin, createRouter } from "@sabit/express";
import { resolveRoutes } from "@sabit/router";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { routeTree } from "./sabit.route.ts";

/*
 * Every api.ts in src/routes is an endpoint: src/routes/users/api.ts → /users.
 * sabit.route.ts lists them all; `sabit dev` keeps it up to date.
 */
const routes = await resolveRoutes(routeTree);

const app = express();
// One line per request (CORS preflights included): method, URL, status, time.
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
// Security headers on every response.
app.use(helmet());
/*
 * Origins allowed to call the API: CORS_ORIGIN (comma-separated). Any origin in
 * development; production refuses to start without CORS_ORIGIN.
 */
app.use(cors({ origin: corsOrigin() }));
/*
 * File routes are rate limited (100 requests a minute per IP) and answer
 * unexpected errors with a plain 500; createRouter(routes, { rateLimit, onError })
 * changes that. Behind a proxy, set app.set("trust proxy", 1) so IPs are real.
 */
app.use(createRouter(routes));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
