# Lessons — how to get a fast answer out of Claude here

The goal: *"change this"* → done in seconds, not minutes of exploring.

Where the time actually goes, in order:

1. **Finding the file** — the biggest cost.
2. **Reading whole files** instead of the 30 lines that matter.
3. **Permission prompts** — each one stops the work until you answer.
4. **Unasked-for work** — docs, refactors, "while I'm here" fixes.
5. **Long summaries** — off by default (`W12`).

The rules (`W1`, `W11`, `W12`) remove #4 and #5. #1 and #2 depend on how you ask.

## 1. Name the file

| Instead of | Say |
| --- | --- |
| "fix catch-all routes on Fastify" | "in `packages/adapters/fastify/src/index.ts`, the catch-all key is wrong" |
| "change what `sabit add` generates" | "in `packages/cli/src/templates.ts` `controllerFile`, return 200 on delete" |
| "the Nest starter is broken" | "`packages/cli/templates/nest/src/app.module.ts` — wrong import → `./sabit.route.js`" |

A line number or symbol (`executeRoute`, `planScaffold`) turns a search into
one `sed -n`. Paste the error: a stack trace with a file and line is a free
answer.

```text
in <file>: <change>
<file>:<line> — <what is wrong> → <what it should be>
same as packages/adapters/hono, do it in packages/adapters/<name>
```

## 2. Phrases that slow things down

- "check if …" / "have a look at …" — a survey, not a change. Say what to do
  with the answer.
- "make sure everything works" — a full build of every package. Name the
  check: "run the fastify tests".
- "fix the CLI" — no file, no symptom: expect a long search.

## 3. Ask for the slow path when it matters

- "run the conformance suite" — any change to routing, responses or an adapter
  (`C3`).
- "test it on a real project" — template or CLI changes (`C9`): built CLI,
  scratch project, its own `lint`/`build`/`dev`.
- "compare against main" — after a refactor (`W6`).
- "write the requirement first" — the only way to get a `claude/<feature>/` doc
  (`W10`).

## 4. Skills and agents

| Name | Use it when |
| --- | --- |
| `/add-rule` | You said something that should hold from now on. |
| `/feature-requirement` | You want `requirement.txt` + a plan before code. |
| `/strict-execution` | The ask is small and you want zero exploration. |
| `/token-budget` | The target file is unknown and you want the search kept tight. |
| `debug` agent | Say "debug" with an error: it reproduces, fixes and proves it. |
| `review` agent | Say "review": the working tree vs `main`, against the rules. |

## 5. Before you send

- Did I name the file or symbol?
- Did I paste the error, not describe it?
- One change per message?
- Do I want a check run? Name it.
