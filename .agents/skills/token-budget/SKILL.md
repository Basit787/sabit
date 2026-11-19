---
name: token-budget
description: Long form of rule W11 (how much to read, run and say). Load only when the user asks to keep it cheap, short or "low token" by name — W11 already applies on every ask.
---

# Token budget

Cost here is dominated by **reading** and by **re-reading**. The task is done when
the requested change is made — not when the codebase has been surveyed.

## Locating code

1. `grep -rln "<symbol>" packages tests --include='*.ts'` to find the file.
   Layout is predictable (`C1`): the engine is `packages/router/src/<stage>.ts`
   (`segments`, `compile`, `resolve`, `execute`, `context`, `response`,
   `middleware`, `route`, `format`, `matcher`), adapters are one file each at
   `packages/adapters/<name>/src/index.ts`, CLI commands are
   `packages/cli/src/commands/<name>.ts`, generated code is
   `packages/cli/src/templates.ts` + `codegen.ts`, starters are
   `packages/cli/templates/<framework>/`.
2. `grep -n` inside that file to find the line.
3. `sed -n 'A,Bp' <file>` to read only that region, padded a little.

Read a whole file only when you actually need the whole file (rewriting it,
or matching its comment style across the file — `C11`). Never `cat` a large file
to find one function.

## Cheap by default

- Batch independent commands into ONE call: `cmd1 && echo --- && cmd2`.
- Send independent tool calls in the same message, not one per turn.
- Pipe through `head`/`tail`; cap noisy output (`| head -50`).
- `git diff --stat` before `git diff`.
- Never re-read a file you just wrote — the edit already failed loudly if it
  did not apply.
- Never re-search for something established earlier in this conversation.
- Typecheck and test once, at the end, not after each edit (`C8`).

## Do not spend tokens on

- Exploring files unrelated to the change.
- Reading tests, docs or config that the change does not touch.
- Subagents or workflows (`W9`) — they re-read everything you already read.
- Requirement/plan/summary files (`W10`).
- Restating the request, narrating what you are about to do, summarising what
  you changed, or pasting back a diff the user can already see (`W12`).
- Re-investigating a reference you were told to copy (`W23`): strip data URIs
  and SVGs with one script, read the reference once, copy it, map the data
  slots, type-check once. No version comparisons, no doc or git archaeology.

## When to spend

Spend freely on the thing that is actually risky: the exact call site being
changed, the public contract (`W2`), cross-framework behavior (`C3`), and the evidence
that the change works (`W5`). Cheap is not the same as unverified — if a check
was skipped, say so (`W8`).

## Output shape

Nothing, by default — finish the edit and stop (`W12`). The only things worth
saying: a check that failed (with its output), something asked for that was
skipped, an assumption made to get unblocked, or a blocking question.
