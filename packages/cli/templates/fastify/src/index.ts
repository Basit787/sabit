import { fileRoutes } from "@sabit/fastify";
import { resolveRoutes } from "@sabit/router";
import Fastify from "fastify";
import { routeTree } from "./sabit.route.ts";

const app = Fastify({ logger: true });

// Every api.ts in src/routes is an endpoint: src/routes/users/api.ts → /users.
// sabit.route.ts lists them all; `sabit dev` keeps it up to date.
await app.register(fileRoutes, { routes: await resolveRoutes(routeTree) });

await app.listen({ port: Number(process.env.PORT ?? 3000) });
