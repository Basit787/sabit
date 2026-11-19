---
name: add-rule
description: Capture a new project rule, convention, preference or correction into .agents/rules/ so it applies in every future session. Use whenever the user states a durable instruction about how work in this repo should be done — "always/never X", "from now on", "the rule is", "remember that", "don't do X again" — and whenever they explicitly ask to add a rule.
---

# Add a project rule

Persist a durable instruction as a rule so it survives the session. Rule files
load automatically — no import step. Each rule lives in exactly one file.

## What belongs here

Durable statements about **how work is done in this repo**: conventions,
constraints, corrections, gotchas that cost time once and would cost time again.

NOT here: anything about one task only, anything the code or git history already
says, and anything about a single feature's requirements — those go in
`claude/<feature>/requirement.txt` (use the `feature-requirement` skill).

## Steps

1. **Restate the rule in one sentence.** If two readings would lead to different
   behaviour, ask before writing. Do not invent scope the user did not state.

2. **Pick the file** by what the rule governs:
   - `.agents/rules/00-working-agreement.md` — how to work (process, scope,
     verification, output). IDs `W#`.
   - `.agents/rules/10-sabit-conventions.md` — code in this repo: package
     boundaries, adapters, conformance, TypeScript, CLI templates, checks. IDs `C#`.
   - `.agents/rules/20-docs-and-requirements.md` — feature doc format. IDs `D#`.
   - `.agents/rules/30-new-unit-scaffold.md` — shape of a new adapter, CLI
     command or framework template. IDs `S#`.
   - Only if none fits, create a new `NN-<topic>.md` beside the closest one and
     list it in the "Rules" section of `AGENTS.md`.

3. **Check for an existing rule that already covers it.** Read the target file
   first. If one exists, UPDATE it in place — never append a near-duplicate. If
   the new rule contradicts an existing one, say so and ask which wins.

4. **Write it** in the house format — next free ID in that file, heading, then
   the rule, then why it exists:

   ```
   ### C9 <short imperative title>
   <The rule as an instruction, 1–4 lines. Add "Why: <the concrete failure>"
   in one line only when the rule would otherwise look arbitrary.>
   ```

   Rules load into every session, so every line costs tokens on every turn:
   imperative, specific, no examples or history unless they ARE the rule.

5. **Name it in one line** — the file and the ID (`W12` allows this much so the
   user can correct the wording). Do not paste the rule back or summarise it.

## Notes

- Keep each rule short enough to quote. Split a rule that needs a paragraph.
- If the user is correcting something that just happened, capture the general
  rule, not the incident.
- Rules apply to this repo only. Anything about the user themselves or their
  cross-project preferences is memory, not a project rule.
