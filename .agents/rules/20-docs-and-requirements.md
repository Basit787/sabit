# Feature docs (`claude/<feature>/`) — quote as `D1`

### D1 Lint-clean markdown
`requirement.txt` and `implementation.md`: blank line around every heading,
list, table and fence; a language on every fence; aligned table pipes; no
trailing spaces; one newline at EOF. Why: Biome formats markdown in `pnpm lint`.

### D2 Docs move with the API
When a public API, CLI command or flag is added or changed, the feature's docs
and the package README are amended in the same turn. Deletions are exempt
(`W16`). Why: the READMEs are the npm pages.

### D3 One yes/no statement per requirement
Why: a requirement that can't be checked can't be verified (`W5`).

### D4 `implementation.md` opens with a status line
Why: the folder outlives the work; the reader needs to know if it's done.

### D5 Never paste the prompt into a doc
`## Task` restates the ask neutrally; what the prompt supplied becomes
Scenarios, Requirements or Decisions. Why: docs are read by contributors, not
the person who asked.
