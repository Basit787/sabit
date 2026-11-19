# {{name}}

A Fastify API built with [sabit](https://github.com/Basit787/backend-file-based-routing):
every folder in `src/routes` is a URL.

## Start

```sh
npm install
npm run dev          # http://localhost:3000
```

## What goes where

```text
src/
├── index.ts            starts the server
├── middleware.ts       who may call what; runs before every route
├── sabit.route.ts      generated list of routes (don't edit)
└── routes/
    ├── api.ts          GET /
    └── users/
        ├── api.ts      GET /users, POST /users (+ sample data)
        ├── schema.ts   what a user looks like; request bodies are checked
        └── [id]/api.ts GET, PUT, PATCH, DELETE /users/:id
```

- **New endpoint:** `npx sabit add products`, or create `src/routes/products`
  while `npm run dev` runs. Delete the folder to remove it.
- **Endpoint code:** in `api.ts`, export `GET`, `POST`, … functions; what they
  return is sent as JSON.
- **Request checks:** `schema.ts` in the folder, Mongoose-style:
  `name: { type: String, required: true }`, `price: { type: Number, min: 0 }`.
- **Who may call what:** `src/middleware.ts`. Writes need a signed-in user and
  deletes need an admin; replace its `user()` with your real auth. Until then:
  `AUTH_TOKEN=secret npm run dev` and send `Authorization: Bearer secret`.
- **Shared code** (db, Kafka, RabbitMQ, AWS, Azure clients): `src/lib/`, one
  file each.
- **Helpers next to routes:** start the name with `_` (like `routes/_utils.ts`).

## Scripts

| Script           | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `npm run dev`    | Start with reload; new route folders get created |
| `npm run build`  | Compile to `dist/`                               |
| `npm start`      | Run the compiled server                          |
| `npm run routes` | List every endpoint                              |
| `npm run lint`   | Lint                                             |
| `npm run format` | Format                                           |
