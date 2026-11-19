import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { corsOrigin, fileRoutes } from "@sabit/fastify";
import { resolveRoutes } from "@sabit/router";
import Fastify from "fastify";
import { routeTree } from "./sabit.route.ts";

// The logger writes one line per request (method, URL, status, time).
const app = Fastify({ logger: true });

// Security headers on every response.
await app.register(helmet);
/*
 * Origins allowed to call the API: CORS_ORIGIN (comma-separated). Any origin in
 * development; production refuses to start without CORS_ORIGIN. The plugin
 * allows only GET, HEAD and POST unless the methods are listed.
 */
await app.register(cors, {
  origin: corsOrigin(),
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

/*
 * Every api.ts in src/routes is an endpoint: src/routes/users/api.ts → /users.
 * sabit.route.ts lists them all; `sabit dev` keeps it up to date. File routes are
 * rate limited (100 requests a minute per IP), accept bodies up to 100 KB and
 * answer unexpected errors with a plain 500 (options: rateLimit, bodyLimit, onError).
 */
await app.register(fileRoutes, { routes: await resolveRoutes(routeTree) });

// Fastify listens on localhost only unless HOST is set (the Dockerfile sets 0.0.0.0).
await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST });
