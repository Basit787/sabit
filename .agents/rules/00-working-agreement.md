# Working agreement (all repos) — quote as `W3`

### W1 Do exactly what was asked
Only the named change, in the files it needs: no extra edits, files, docs,
tests, refactors or "while I'm here" fixes; a new file only when asked. Anything
else that looks wrong: one sentence, leave it.

### W2 The public contract stays identical
Package exports, routing conventions, response/status behavior, CLI commands,
flags and generated file layout stay identical unless the task is to change them.

### W3 Minimal diff
No renames, reformatting, reordering or new dependencies.

### W4 Reuse what exists — never a parallel copy
Before writing any function, helper, model query, type, enum, constant, guard,
service or page, `rg` for one that already does the job (by behaviour and query
fields, not just name) and call it as it is. New code only when nothing fits —
never a second version, wrapper or "V2" beside an existing one, auth/ownership
checks above all. Don't merge existing duplicates unless asked (`W1`).
Why: new parallel code drifted from the original and blocked working features.

### W5 Verify by running, not reading
`pnpm typecheck` and the affected package's `pnpm test` (adapter or router
behavior: the conformance suite), `pnpm lint` (`C8`); CLI changes: run the
built CLI on a scratch project. Name the check in a few words.

### W6 Check against `main` before done
`git diff main --stat`; look for imports of deleted files, comments pointing at
deleted code, non-additive changes to shared services, and `W26`. Report only
findings.

### W7 Forget `dist/`
Never scan, read or mention it — no stale `dist/*.js` notes or delete
reminders (`C10`).

### W8 Report only exceptions
A failed check (with output), something skipped (why), an assumption, a
blocking question. Never call read-only work "verified".

### W9 No subagents or workflows unless asked
Only when the user asks for one or names it.

### W10 Feature docs only when the user mentions them
Write or edit `claude/<feature>/` `requirement.txt` + `implementation.md` only
when the user asks for them in that message — never on your own, new feature
included. When asked: status line and a "where this stands" section (done /
blocked / next). No other plan/report/summary file unprompted.

### W11 Fewest tokens that still get it right
`rg` to locate, `sed -n 'A,Bp'` to read the region; whole files only when the
whole file matters. Never re-read what you just edited or re-search what is
established. Independent calls in one message. Don't load a skill or spawn an
agent when the rules already answer the ask.

### W12 No preamble; close in two lines
No plan or narration up front. Close with ONE or TWO lines: what changed and
anything the user must do by hand. No per-file list, investigation story,
"verified X", next steps or offers. A blocking issue gets one more sentence.

### W13 "Debug" means fix it in the same turn
A debug ask, or a pasted error/log/broken screenshot: trace against the intended
behaviour and apply the fix now. Ask only if it is ambiguous or destructive.

### W14 Deep pass only on trigger phrases
"debug this application", "generate preview", "generate the report", "give me
the result": read the whole path and run the checks (type-check, route dump,
every caller, logs), answer from data. Debug triggers fix (`W13`); report
triggers change no code. Everything else stays on `W11`.

### W15 A pasted curl is a go-ahead
For a feature with a `claude/<feature>/` folder: code + type-check in one turn,
no approval stops. Amend its docs only if the user mentions them (`W10`).

### W16 "Remove / update / add this" — nothing else
Make it, fix broken imports and callers, type-check, stop. No doc edits, no
neighbouring rewrites.

### W17 Plainest code, one step ahead
The file's existing shape; reuse what is in scope; no extra variables, wrappers
or coercion the neighbours lack (`C11`, `C12`, `S7`). First think through the
other paths: stored formats (phones carry the country code), a trigger on a
function that also runs for the opposite case, a per-row DB read in a batch, a
value undefined on another path. A remaining risk gets one sentence.

### W18 "Completed" / "what's today's task?"
One ```text block, nothing outside it. Cover the whole day: `git log
--since=midnight --author=<git user> --all` + `git status` in
this repo, plus this session and any work the user names.
One numbered line per feature: its name bold as `*Name*`, a colon, then the day's main work in
about 15–20 words, plain text, no sub-points. All the day's work on
a feature is one line — never split it. Lead with any delivery or handover
("delivered X to the Y team"). No status suffix, no paths, no next steps:

```text
*Completed:*-

1. *CLI*: arrow-key prompts for npm create sabit, local registry support, and a project-level .npmrc for custom registries
2. *Route tree*: generated src/sabit.route.ts kept current by sabit dev and sabit add, used by every starter
```

### W19 No text between tool calls
None, IDE Focus view included. Speak only at the close or for a blocking
question.

### W20 Build from the nearest existing implementation
Copy its decode/checks, method style, reply/error shape and layout. Never invent
an API, field, enum, template id or helper (`C11`); never leave it half-wired.
A new backend reply/reason code shown by the client gets its message in the
client's map in the same change.

### W21 No debug logging unless asked
No added `console.log/info/warn`; remove them when told. Existing `catch`
logging stays.

### W22 Report/template redesign: prototypes first
Prototype HTML in `claude/<feature>/versions/` (positive/negative) + the feature
docs first. Services, live `src/public/**` templates and labels only after
approval.

### W23 "Make it exactly like X" is a copy job
Strip `data:`/base64 and SVGs with a one-off script, read the reference once,
copy CSS/markup verbatim, map only data slots to existing fields, type-check
once. No re-deriving, version comparisons or doc/git digging; a handful of
calls. Ask only if a slot has no source.

### W24 Cosmetic tweak is one edit
Colour, spacing, size, wording: edit the owning file, mirror into its prototype
if any, stop. Render only if structural or asked.

### W25 Turn every ask into a precise prompt first — silently
Before acting, fix the message's spelling and typos, then rewrite it internally
as a clear prompt: goal, target files/symbols, rules that apply, done-check.
Fill the slots from the code with the fewest lookups, then carry out the task;
never print the rewrite (`W12`). Ask one question only if a slot cannot be filled.
Why: loose asks led to wrong targets and re-runs.

### W26 Never delete code that wasn't named
No function, export, route, model field, cron handler, label or file is removed
unless the user named it. Code that looks unused, old or duplicated stays: `rg`
its name across `packages/`, `tests/` and the CLI templates — any hit, keep it;
no hit, still keep it and mention it in one line. Why: deleted "unused" code broke production.
A redesign, replace or "remove unwanted code" swaps only what was named; every
send (WhatsApp/email/notification), trigger, DB/Redis write and caller-visible
return carries over into the new code. Before done, list every call on a `-`
line of the diff that is gone from the file; each must be asked for by name or
proven dead (no caller, no side effect) — otherwise put it back. Why: a
template redesign dropped the monthly report's WhatsApp sends in prod.

### W27 "Commit" or "branch" in an ask → the git commands, copyable
Name the branch and commit from `git diff`/`git status` of the work — branch always
typed-prefixed: `feat/`, `fix/`, `bug/`, `chore/`, `refactor/` + kebab-case — then give one
` ```bash ` block under `**Commands**`, picked from `git branch --show-current` and
`git rev-parse --abbrev-ref @{u}`: on `main` → no stash/pull, start at
`git checkout -b <branch>`, `git add .`,
`git commit -m "<msg>"`, `git push --set-upstream origin <branch>`; on another branch →
`git add .`, `git commit -m "<msg>"`, then `git push` if it has an upstream, else
`git push --set-upstream origin <branch>`. Never a push to `main`. No `Co-Authored-By`
or other Claude attribution line in the message. One risk line max.

### W28 "New story" → `plan.md`, then plan mode
On "new story": write only `claude/<feature>/plan.md` — no `requirement.txt`,
`implementation.md` or `feature-requirement` skill (overrides `W10`) — then
`EnterPlanMode` and carry the work out from that plan.

### W29 "Notepad / copy / Insomnia collection" → one Insomnia v4 JSON block
For the story's APIs, reply in chat with one ` ```json ` block: an Insomnia v4 export
(`_type: "export"`, `__export_format: 4`), workspace named after the feature, a Base
Environment (`base_url` `http://localhost:3000`, empty token vars), one
`request_group` per guard, one request per endpoint with its real path, method,
`{{ _.var }}` headers and body/query from the controller. One resource object per line;
never a real secret. Why: a pretty-printed export copied via Notepad failed to import.
