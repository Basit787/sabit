# create-sabit

Creates a backend project with [sabit](https://github.com/Basit787/backend-file-based-routing)
file-based routing:

```sh
npm create sabit
# or: pnpm create sabit / yarn create sabit / bun create sabit
```

You're asked for the framework (Express, Hono, Fastify, NestJS), package
manager, linter (the framework's default, Biome, or none), whether to install
dependencies, and whether to initialize git. Skip questions with options:

```sh
npm create sabit my-api -- --framework hono --pm pnpm --lint biome --install --git
```
