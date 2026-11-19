import { createRouter } from "@sabit/express";
import { resolveRoutes } from "@sabit/router";
import express from "express";
import { routeTree } from "./sabit.route.ts";

// Every api.ts in src/routes is an endpoint: src/routes/users/api.ts → /users.
// sabit.route.ts lists them all; `sabit dev` keeps it up to date.
const routes = await resolveRoutes(routeTree);

const app = express();
app.use(createRouter(routes));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
