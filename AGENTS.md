<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# sabit — instructions for every coding agent

This file is the one entry point for all agents (Claude, Codex, Gemini, Cursor,
...). The detailed rules live in `.agents/`; read the ones below before working.

sabit is a pnpm + Turborepo monorepo (TypeScript 7, ESM): the routing engine
`packages/router`, adapters for Express/Hono/Fastify/NestJS in
`packages/adapters/*`, Mongoose-style schemas `packages/schema`, the CLI `sabit`
in `packages/cli` (starters in `packages/cli/templates/`) and `create-sabit`.
Design notes: `ARCHITECTURE.md`.

## Rules (instructions, not background)

- `.agents/rules/00-working-agreement.md` — how to work (`W#`)
- `.agents/rules/10-sabit-conventions.md` — code conventions and checks (`C#`)
- `.agents/rules/20-docs-and-requirements.md` — feature docs (`D#`)
- `.agents/rules/30-new-unit-scaffold.md` — new adapter / command / template (`S#`)

In one line: do exactly what was asked, in those files, nothing else (W1, W3,
W10); fewest tokens (W11); no preamble, a one-or-two-line close (W12); never
commit or push (W27 gives the commands).

## Checks

`pnpm typecheck`, `pnpm test`, `pnpm lint` (C8). Try the CLI like a user:
`make local-up`, then `npm_config_registry=http://localhost:4873 npm create sabit@latest`.

## Skills and agents

Step-by-step guides in `.agents/skills/<name>/SKILL.md` (`add-rule`,
`feature-requirement`, `strict-execution`, `token-budget`) and agent briefs in
`.agents/agents/` (`debug`, `review`). Use them when the user names them. A
durable rule from the user ("always/never", "from now on") goes through
`add-rule`. `.agents/lessons.md` is for humans: how to ask for fast results.
