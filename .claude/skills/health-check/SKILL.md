---
name: health-check
description: Periodic health check of this repository. Runs the automated gate (npm run check), then reviews what tools cannot judge — security and tenant isolation, docs that contradict code, broken wiring between database, functions and UI, data-model risks, scope creep, maintainability — and reports verified findings ranked by severity. Use when asked to "health-check", "lint the repo", "audit the codebase", or before a release. Optional argument: an area to focus on (e.g. "security", "docs", "schema").
---

# Repository health check

Goal: keep the codebase correct, coherent and small as it grows. You are reviewing, not fixing.
Read `CLAUDE.md` first; it is the contract the code is checked against.

## 1. Run the automated gate

Docker must be running. Then, from the repo root:

```sh
npx supabase start          # if not already running
npm run db:reset            # fresh schema + seed (the tests depend on the seed)
npm run check               # lint + build + db lint + types drift + pgTAP + Deno tests
npm audit --omit=dev; npm audit --omit=dev --prefix web
npm outdated; npm outdated --prefix web      # informational
git log --oneline -20; git status --short
```

Every failure of `npm run check` is a finding (severity at least **high**); report the exact output.
Do not re-check by reading code what the gate already proves (types, lint rules, the schema rules in
`supabase/tests/database/invariants.test.sql`). Spend the review on what it cannot prove.

## 2. Review

If an argument names a focus area, cover that area deeply and the others briefly. For each area,
look for the problems described, using `git diff main...HEAD` or recent history to prioritize what
changed since the last check.

**A. Security and tenant isolation** (the most important area)
- A table, policy, RPC or Edge Function that is not scoped by school/class membership, or that trusts
  an id from the client without checking the caller's relation to it.
- `SECURITY DEFINER` functions that skip the caller check, or return more than the caller may see.
- Student-visible paths that leak answers, keys, marks or comments before the teacher returns work.
- Scores, roles or ownership accepted from the client; secrets or service keys reachable from `web/`.
- New security behaviour with no pgTAP test in `security.test.sql` (both the allowed and denied case).

**B. Docs and comments that disagree with the code**
- Claims in `CLAUDE.md`, file headers, function comments or migration comments that are no longer true.
- Names that survive after a rename (search for the old identifier).
- Commands in docs that no longer exist in `package.json`.

**C. Wiring between layers**
- RPCs, tables or columns nothing uses; frontend calls to things that do not exist (the generated types
  catch most of this; look at Edge Function bodies, SQL strings and raw `fetch`, which they do not).
- Routes in `web/src/main.ts` no page links to; pages that link to missing routes.
- Edge Functions not called from the UI, or called with a body shape they do not accept.
- Seed data that no longer exercises every table and role the tests rely on.

**D. Data model and migrations**
- An applied migration that was edited (compare `supabase/migrations` against `origin/main`): never
  edit; add a new migration.
- Missing constraints (NOT NULL, CHECK, UNIQUE), wrong `ON DELETE` behaviour that could silently
  destroy student work, JSON shapes that drift from the documented `content` / `key` formats.
- Data migrations that assume a single school, or would fail on production data shapes.

**E. Scope**
- Code, dependencies, files or features that do not serve this product (French homework for schools:
  accounts, assignments, submissions, grading). Speculative abstractions, unused config, leftovers from
  experiments, files that belong in the scratchpad rather than the repo.

**F. Maintainability and conventions**
- Duplicated logic that should be shared (e.g. grading rules outside `private.grade_answers`).
- Departures from the conventions in `CLAUDE.md`: `el()` for DOM, `confirmButton` instead of dialogs,
  French UI text, writes through RPCs, `void` for intentionally un-awaited promises.
- Functions or pages that have grown too large to review safely.

**G. Operations**
- Deploy config that disagrees with the docs (workflow file names, secrets, env vars, regions).
- Vulnerable or badly outdated dependencies; CI steps that no longer run what `npm run check` runs.
- Free-tier risks (project pausing, no backups) that have become relevant.

## 3. Verify before reporting

For each candidate finding, confirm it: open the file, run the query or command, or write a quick
check. Drop anything you cannot confirm or that is a matter of taste. A short list of real problems
is the goal; padding it makes the real ones easier to miss.

## 4. Report

Reply with:

1. **Gate:** pass/fail of each `npm run check` step, plus audit results (one line each).
2. **Findings**, most severe first. For each: severity (**critical** / **high** / **medium** / **low**),
   area (A–G), `file:line`, what is wrong, the evidence, and the smallest fix.
3. **Automate it:** for any finding a tool could have caught, say which check to add (an ESLint rule,
   a test in `invariants.test.sql`, a Knip setting, a CI step) so it cannot come back.
4. **Healthy:** one or two lines on what looked good, so the next check knows what was covered.

Then stop and ask which findings to fix. Fixes go on a branch (`chore/health-YYYY-MM-DD`) and reach
`main` through a PR, per `CLAUDE.md`.
