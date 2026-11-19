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

| Option                                                              | Works on       |
| ------------------------------------------------------------------- | -------------- |
| `required`, `default`                                               | every type     |
| `enum`                                                              | String, Number |
| `min`, `max`                                                        | Number, Date   |
| `minLength`, `maxLength`, `match`, `trim`, `lowercase`, `uppercase` | String         |

Unknown fields are dropped, and a bad request gets a `400` listing every
problem. Creating an empty `schema.ts` while `dev` runs fills in a starter.
Validation uses Zod underneath; `schema.zod` is the Zod schema if you need it.

## Protect routes: `src/middleware.ts`

One file decides who may call what, like Next.js's `middleware.ts`:

```ts
// src/middleware.ts
import { guard } from "@sabit/router";

export default guard({
  rules: [
    { path: "/**", methods: ["POST", "PUT", "PATCH", "DELETE"] }, // writes: signed in
    { path: "/**", methods: ["DELETE"], role: "admin" }, // deletes: admins
    { path: "/admin/**", role: "admin" }, // a whole area
  ],
  user(ctx) {
    // Who is calling: verify a JWT, look up a session...
    // Return { id, role } or undefined.
  },
});
```

- A request matching no rule is public.
- No user → `401`; wrong role → `403`.
- Paths are folder paths: `/products` (exactly), `/products/*` (one level
  below), `/products/**` (everything below).

New projects start with the two write rules above and a demo `user()`:
`Authorization: Bearer <ADMIN_TOKEN>` is an admin and `Bearer <AUTH_TOKEN>` is
a user. Replace `user()` with your real auth.

```sh
AUTH_TOKEN=secret npm run dev
curl -X POST localhost:3000/products -H 'authorization: Bearer secret' \
  -H 'content-type: application/json' -d '{"name":"Pen"}'
```

## Commands

| Command                | What it does                                  |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Run with reload; new folders become endpoints |
| `npx sabit add <name>` | Create a resource (`--no-item` skips `[id]`)  |
| `npx sabit watch`      | Only the folder watching, without a server    |
| `npx sabit routes`     | List every endpoint                           |
| `npx sabit generate`   | Rewrite `src/sabit.route.ts`                  |
| `npm run build`        | Compile for production (`npm start` runs it)  |

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

| Package                                         | What it is                     |
| ----------------------------------------------- | ------------------------------ |
| [`create-sabit`](./packages/create-sabit)       | `npm create sabit`             |
| [`sabit`](./packages/cli)                       | the `sabit` command            |
| [`@sabit/router`](./packages/router)            | the routing engine             |
| [`@sabit/schema`](./packages/schema)            | `defineSchema` for `schema.ts` |
| [`@sabit/express`](./packages/adapters/express) | Express 5                      |
| [`@sabit/hono`](./packages/adapters/hono)       | Hono 4                         |
| [`@sabit/fastify`](./packages/adapters/fastify) | Fastify 5                      |
| [`@sabit/nest`](./packages/adapters/nest)       | NestJS 12 on platform-express  |

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
