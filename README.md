# sabit

Build a backend API by creating folders. Each folder in `src/routes` is a URL,
and the `api.ts` inside it is the code for that URL. Works with **Express,
Hono, Fastify and NestJS**, and behaves the same on each.

> **Status: pre-release.** Everything below works and is tested, but nothing
> is published to npm yet. To try it now, see [Developing sabit](#developing-sabit).

## Start a project

```sh
npm create sabit@latest
```

It asks for a folder name, the framework, your package manager, a linter, and
whether to install dependencies and set up git. Then:

```sh
cd my-api
npm run dev          # http://localhost:3000
```

## What goes where

```text
src/
├── index.ts            starts the server (NestJS: main.ts + app.module.ts)
├── middleware.ts       who may call what; runs before every route
├── sabit.route.ts      generated list of all routes (don't edit)
└── routes/             your API: folder = URL
    ├── api.ts          GET /
    └── products/
        ├── api.ts      GET /products, POST /products
        ├── schema.ts   what a product looks like (request bodies are checked)
        └── [id]/
            └── api.ts  GET, PUT, PATCH, DELETE /products/:id
```

| You want to…                      | Put it in                                         |
| --------------------------------- | ------------------------------------------------- |
| add an endpoint                   | `src/routes/<path>/api.ts`                        |
| use a value from the URL          | a `[name]` folder → `params.name`                 |
| check request bodies              | `schema.ts` in that folder                        |
| decide who may call what          | `src/middleware.ts`                               |
| share code (helpers, db, clients) | `src/lib/` (create it when you need it)           |
| keep a helper next to a route     | a name starting with `_`, like `routes/_utils.ts` |

## Add endpoints

Either run:

```sh
npx sabit add products
```

or just create the folder while `npm run dev` is running (VS Code also runs the
watcher for you when you open the project):

```sh
mkdir src/routes/products
```

Both create `api.ts`, `[id]/api.ts` and `schema.ts` with working sample data.
Delete a folder and its routes disappear. Nested folders give nested URLs:
`src/routes/admin/reports` → `/admin/reports`.

## Write an endpoint

An `api.ts` exports one function per HTTP method. Whatever it returns is sent
as JSON:

```ts
// src/routes/products/[id]/api.ts
import { HttpError, type RouteContext, reply } from "@sabit/router";

type Context = RouteContext<"/products/[id]">;

export const GET = ({ params }: Context) => {
  const product = products.find((p) => p.id === params.id);
  if (!product) throw new HttpError(404, "Product not found");
  return product; // 200 + JSON
};

export const DELETE = ({ params }: Context) => {
  remove(params.id); // returning nothing → 204
};

export const POST = ({ body }: Context) => reply(201, create(body)); // custom status
```

Each handler gets `params`, `query`, `body`, `headers`, `method`, `path` and
`state` (`state.user` is the signed-in user, set by `middleware.ts`).

## Check request bodies: `schema.ts`

Put a `schema.ts` in a route folder. POST and PUT bodies for every route in
that folder (and below) must match it; PATCH checks only the fields sent.
Fields are written like a Mongoose model, with autocomplete:

```ts
// src/routes/products/schema.ts
import { defineSchema } from "@sabit/schema";

export default defineSchema({
  name: { type: String, required: true, trim: true },
  price: { type: Number, min: 0 },
  status: { type: String, enum: ["draft", "live"], default: "draft" },
  tags: [String], // a list
  size: { width: Number }, // a nested object
});
```

- A body that doesn't match is answered with `400` listing every problem.
- The route gets the checked body: defaults filled in, unknown fields dropped.
- Zod, Valibot or any other Standard Schema works too.
- Create an empty `schema.ts` while `sabit dev` runs to get a starter.

## Protect routes: `src/middleware.ts`

`src/middleware.ts` lists every route and who may call it. sabit adds new
routes to the list as public (`false`); change the value to protect one:

```ts
const access: Partial<Record<RoutePattern, AuthExport>> = {
  "/products": { POST: true }, // writes: signed in
  "/products/[id]": { PUT: true, DELETE: "admin" }, // deletes: admins
  "/users": "admin", // a whole route
};
```

- `false` is public, `true` needs a signed-in user, `"admin"` that role.
- Deleting a route folder removes its entry.
- No user → `401`; wrong role → `403`.
- The middleware asks `src/auth/index.ts` who is calling (`currentUser`).

New projects start with a demo `currentUser`: `Authorization: Bearer
<ADMIN_TOKEN>` is an admin and `Bearer <AUTH_TOKEN>` is a user.

```sh
AUTH_TOKEN=secret npm run dev
curl -X POST localhost:3000/products -H 'authorization: Bearer secret' \
  -H 'content-type: application/json' -d '{"name":"Pen"}'
```

### Real sign-in: `sabit setup auth`

Pick one; both keep their code in `src/auth/` (one small file per job, helpers
in `src/auth/utils/`) and have the same routes: `POST /auth/register`,
`/auth/login`, `/auth/logout` and `GET /auth/me`. Register takes `name`,
`email` and `password`; login takes `email` and `password`. On the first start
in development they create an `admin@example.com` / `12345678` admin; change
its email and password after signing in (it isn't created again while an admin
exists).

| Option      | Flag                 | What you get                                                                    |
| ----------- | -------------------- | ------------------------------------------------------------------------------- |
| Custom JWT  | `--auth jwt`         | your own code; cookies, plus `/auth/refresh` with token rotation                |
| Better Auth | `--auth better-auth` | [Better Auth](https://better-auth.com/docs) behind each route; needs a database |

Better Auth keeps sessions in your database and answers `Authorization: Bearer <token>` for API
clients. `/users` becomes admin-only account management with either.

## API docs: `/docs`

Open <http://localhost:3000/docs> while the app runs: Swagger UI for every
route. It's built into sabit (there's no docs folder in `src/routes`) and made
from the routes the server loaded, so a new folder or a changed `schema.ts`
shows up as soon as `npm run dev` reloads. It shows:

- every path and method, with `[id]` folders as path params;
- request bodies from `schema.ts`;
- a lock on routes the access list protects ("Authorize" takes a Bearer token).

The raw OpenAPI 3.1 document is at `/docs/openapi.json`. Add summaries or
hide a route with a `docs` export:

```ts
export const docs = { GET: "List products", POST: "Create a product" };
// or: export const docs = false;
```

In production `/docs` answers 404 unless `API_DOCS=true`. The URL `/docs` is
taken, so `src/routes/docs` isn't allowed (`npm run dev` removes a new empty
one); nested folders such as `src/routes/products/docs` are fine.

## Commands

| Command                | What it does                                  |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Run with reload; new folders become endpoints |
| `npx sabit add <name>` | Create a resource (`--no-item` skips `[id]`)  |
| `npx sabit setup`      | Add a database, auth, services or Docker      |
| `npx sabit watch`      | Only the folder watching, without a server    |
| `npx sabit routes`     | List every endpoint                           |
| `npx sabit generate`   | Rewrite `src/sabit.route.ts`                  |
| `npm run build`        | Compile for production (`npm start` runs it)  |

With a database (`npx sabit setup database`), `npm run dev` also keeps it in
step with your schema: change `prisma/schema.prisma` or `src/db/schema.ts` and
it writes a migration named after the change (`init`, `create_posts`,
`add_nickname_to_users`) into `prisma/migrations/` or `drizzle/`, then applies
it. Commit those files with the schema.

## Growing the project

Keep the shape flat and add folders only when you need them:

```text
src/
├── routes/        HTTP endpoints (as above)
├── middleware.ts  who may call what
└── lib/           connections and shared code, one file each:
    ├── db.ts          your database client
    ├── kafka.ts       Kafka producer/consumer setup
    ├── rabbitmq.ts    RabbitMQ channel
    ├── s3.ts          AWS clients
    └── blob.ts        Azure clients
```

Import them from `api.ts` files: `import { db } from "../../lib/db.ts"`.
Message consumers (Kafka topics, RabbitMQ queues) are planned to get their own
folder that works like `routes/`: one folder per topic or queue.

## Routing rules

| File                             | URL                                    | `params`                |
| -------------------------------- | -------------------------------------- | ----------------------- |
| `routes/api.ts`                  | `/`                                    |                         |
| `routes/users/api.ts`            | `/users`                               |                         |
| `routes/users/[id]/api.ts`       | `/users/:id`                           | `{ id: "42" }`          |
| `routes/files/[...path]/api.ts`  | `/files/a/b`                           | `{ path: ["a", "b"] }`  |
| `routes/docs/[[...slug]]/api.ts` | `/docs`, `/docs/a`                     | `{ slug: [] }`, `["a"]` |
| `routes/(admin)/stats/api.ts`    | `/stats` (groups don't add to the URL) |                         |

- `/users/new` beats `/users/[id]`, on every framework.
- Not routes: names starting with `_` (`_lib/`, `_utils.ts`), files with a dot
  in the name (`user.dto.ts`, `api.test.ts`), `schema.ts` and `middleware.ts`.
- A `middleware.ts` inside a routes folder runs for that folder only.
- Two files claiming the same URL is an error at startup, with the file names.

## Packages

| Package                                               | What it is                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| [`create-sabit`](./packages/create-sabit)             | `npm create sabit`                                                         |
| [`sabit`](./packages/cli)                             | the `sabit` command                                                        |
| [`@sabit/router`](./packages/router)                  | the routing engine                                                         |
| [`@sabit/schema`](./packages/schema)                  | `defineSchema` for `schema.ts`                                             |
| [`@sabit/express`](./packages/adapters/express)       | Express 5                                                                  |
| [`@sabit/hono`](./packages/adapters/hono)             | Hono 4                                                                     |
| [`@sabit/fastify`](./packages/adapters/fastify)       | Fastify 5                                                                  |
| [`@sabit/nest`](./packages/adapters/nest)             | NestJS 12 on platform-express                                              |
| [`@sabit/adapter-common`](./packages/adapters/common) | what every adapter shares: safe 500s, rate limit, body limit, CORS origins |

## Developing sabit

To work on sabit itself, or try it before it's on npm:

```sh
git clone https://github.com/Basit787/backend-file-based-routing.git
cd backend-file-based-routing
pnpm install
pnpm build
pnpm test
```

Try the CLI exactly like a user would, from a private local npm registry:

```sh
make local-up                 # start it and publish sabit there
cd ~/somewhere-else
npm_config_registry=http://localhost:4873 npm create sabit@latest
make local-down               # (from the repo) stop it
```

After changing sabit's code, run `make local-publish` and create a new project.
More in [CONTRIBUTING.md](./CONTRIBUTING.md) and
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](./CONTRIBUTING.md), the
[Code of Conduct](./CODE_OF_CONDUCT.md) and [SECURITY.md](./SECURITY.md).

## Author

Created and maintained by **Basit Saleem**
([@Basit787](https://github.com/Basit787), basitsaleem282@gmail.com).

## License

[MIT](./LICENSE) © 2026 Basit Saleem
