# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A homework app for French classes, built first for one TDSB teacher and structured to serve many
schools and teachers. Students sign in, do an assignment (auto-graded where possible), and submit.
Their teachers see the answers, override marks, comment, and "return" the work. Only after it is
returned does the student see marks, correct answers and explanations. UI text is French. Do not use
`alert()` or `confirm()`; use in-page confirmations (`confirmButton` in `web/src/dom.ts`).

`dropoff/` (git-ignored) holds the original reference material (PDFs). The long one is an AI chat
transcript in which the teacher built a single-file HTML prototype and stated her requirements. The
others are printouts of that prototype, which this project replaces.

`INFRASTRUCTURE.md` is the human guide to hosting, security, deployment, costs and operations; keep
it in step with this file.

## Commands

Run these from the repo root. Docker must be running for anything that touches the database.

```sh
npm install && npm --prefix web install
npm run db:start          # local Supabase (applies migrations + seed.sql); prints URL and keys
npm run db:reset          # re-apply migrations + seed after editing SQL
npm run db:types          # regenerate web/src/database.types.ts after a schema change (commit it)
npm run functions:serve   # Edge Functions locally (copy supabase/functions/.env.example to .env first)
npm run dev               # frontend at http://localhost:5173 (copy web/.env.example to web/.env.local first)
npm run build             # type-check + build web/ to web/dist

npm run lint              # ESLint + tsc (web), deno lint + check (functions), Knip (unused code)
npm test                  # pgTAP (needs a fresh db:reset; tests rely on seed data) + Deno unit tests
npm run check             # everything CI runs: lint, build, db lint, types drift, tests
```

One pgTAP file: `npx supabase test db supabase/tests/database/security.test.sql`. The Supabase CLI
and Deno are dev dependencies; run them as `npx supabase ...` / `npx deno ...`. Local Studio runs at
http://127.0.0.1:54323. Seed logins (all `motdepasse123`) are listed at the top of `supabase/seed.sql`:
two schools, an admin, teachers and students, so tenant isolation can be tested.

## Architecture

```
web/ (Vite + TS, static)  ── hosted on Azure Static Web Apps Free; holds no secrets
  │  supabase-js (typed by database.types.ts) with the public anon key + the user's JWT
  ├─► Supabase Auth: email + password, public sign-up DISABLED
  ├─► Postgres via PostgREST: all access enforced by RLS + SECURITY DEFINER RPCs
  └─► Edge Functions (service-role key): only for auth-admin operations
```

Azure only serves files. After the page loads, every request goes from the browser to Supabase.

### Tenancy model (`supabase/migrations/`)

```
schools ─┬─ school_members (user, role: admin | teacher | student)
         ├─ classes ─┬─ class_teachers      (co-teaching allowed)
         │           ├─ enrollments         (a student may be in several classes)
         │           └─ class_assignments   (assignment issued to the class: is_open, due_at)
         └─ assignments (owner_id) ── answer_keys
submissions (assignment, student, class_id = the class it came through, graded_by)
```

- **Roles are per school**, never global. A school **admin** manages every class of the school and
  creates teacher accounts; a **teacher** manages the classes in `class_teachers` and the
  assignments they own (other teachers of the school can view and duplicate them); a **student**
  sees only their enrolled classes. Schools and their first admin are created with SQL (see
  Deployment); nothing in the app can create a school or an admin.
- **Each school sets its email domains** (`student_email_domain`, `staff_email_domain`).
- **RLS uses membership helpers** in schema `private` (not exposed by PostgREST):
  `my_school_ids()`, `my_staff_school_ids()`, `my_admin_school_ids()`, `my_taught_class_ids()`,
  `my_enrolled_class_ids()`, `my_student_assignment_ids()`, `my_school_people_ids()`. They are
  set-returning and argument-free so policies use `x in (select private.fn())`, which Postgres runs
  once per query. Keep new policies in that form.
- **anon has no access** to any table or function, and default privileges keep it that way for new
  objects. Grant `execute` to `authenticated` explicitly for every new RPC.
- **Content is data.** `assignments.content` is `{sections:[{id,title,instructions,questions:[{id,
  type:"choice"|"text",prompt,context?,options?,points?}]}]}`. `answer_keys.key` maps each question
  id to `{correct:<option index>}` or `{accept:[...]}`, plus `explanation`. Question ids are
  generated once and kept across edits, because submissions store answers by question id (and
  choice answers by option position).
- **Every write that matters goes through an RPC:**
  - `save_assignment`: owner or school admin. Validates content (`private.validate_assignment`),
    writes assignment + key, issues it to the caller's classes (`p_classes`; a co-teacher's issue is
    left alone), and re-scores existing submissions (`p_regrade` also redoes `auto_results`;
    teacher marks are kept).
  - `create_class`: staff of the school; the creator becomes the class's teacher.
  - `submit_assignment`: grades on the server via `private.grade_answers`. Choice answers compare by
    original option index; text answers are normalized (`private.normalize_answer`: case, spaces,
    apostrophes, trailing period; accents kept). Matches are `correct`; any other non-empty text is
    `review`, never `incorrect`.
  - `grade_submission` / `return_submissions`: teachers of the submission's class. Bulk return skips
    work with questions still marked `review`.
  - `my_context`, `my_classes`, `my_assignments`, `my_submission_detail`: read models for the UI.
    The student views hide marks, comments and the key until `status = 'returned'`.
- **Scores are computed by a trigger** (`private.compute_submission_score`) from `auto_results`
  overlaid with `teacher_marks`. Never accept a score from the client.
- **Profile lifecycle.** `on_auth_user_created` inserts a bare profile. GoTrue writes
  `app_metadata` after the insert, so the trigger cannot read it; `create-accounts` fills in names,
  honorific, `must_change_password`, the school membership and the enrollment. The
  `on_auth_user_password_changed` trigger clears `must_change_password`, which is why
  `reset-password` sets the flag *after* changing the password.
- **Migrations are forward-only.** Never edit a migration that has reached `main`; add a new one.

### Edge Functions (`supabase/functions/`)

`create-accounts` (students into a class the caller teaches; teachers into a school the caller
administers; temporary passwords returned once) and `reset-password`. Both start with
`_shared/auth.ts` `requireUser()` and then authorize against the specific class, school or person.
Dependency versions live in `supabase/functions/deno.json`, which Deno finds from each function's folder.
Keep anything that does not need the auth admin API in SQL instead. The local gateway answers CORS
with `*`; the `ALLOWED_ORIGINS` echo only matters on the hosted project.

### Frontend (`web/src/`)

A small history-API router (`router.ts`) with guards for session, audience (staff vs student, from
`my_context`) and forced password change, and one module per page in `pages/`. Build every DOM node
with `el()` from `dom.ts`; ESLint bans `innerHTML` and friends because student answers are rendered on
the teacher's screen. The CSP in `web/public/staticwebapp.config.json` also blocks inline scripts and
styles; keep it that way. CSV export goes through `downloadCsv()`, which defuses formula injection.
Table and RPC types come from `database.types.ts`; `types.ts` adds the JSON column shapes.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are baked in at build time. A build without them
still succeeds, but the page only shows a "Configuration manquante" message (`isConfigured` in
`supabase.ts`).

## Keeping the repo healthy

- `npm run check` must pass before a PR merges; `.github/workflows/checks.yml` runs it on every PR.
- Project rules are enforced by tools where possible: ESLint (`web/eslint.config.js`), schema rules
  in `supabase/tests/database/invariants.test.sql` (RLS on every table, no anon access, pinned
  `search_path`, indexed foreign keys), the generated-types drift check, and Knip.
- For judgment calls, run the `/health-check` skill (`.claude/skills/health-check/SKILL.md`)
  periodically. When it finds something a tool could catch, add that check so it cannot recur.

## Git workflow

Never commit directly to `main`. Commit only on a feature branch (or a sub-branch of one), push
it, open a PR into `main`, and merge the PR. A merge to `main` deploys production.

## Deployment

- **Supabase:** project in region `ca-central-1`. `npx supabase link`, then `npx supabase db push`
  (never run `seed.sql` there) and `npx supabase functions deploy`. Secret:
  `npx supabase secrets set ALLOWED_ORIGINS=https://<app>.azurestaticapps.net`. In the dashboard,
  disable sign-ups and add the SWA URL under Auth → URL configuration. Push a migration right
  before merging the PR that needs it: the merge deploys the matching frontend.
- **New school:** in the SQL editor, `insert into schools (name, student_email_domain,
  staff_email_domain)`, create the admin's user in the Auth dashboard, then insert their
  `school_members` row with role `admin` (and set `profiles.honorific` if wanted). The admin adds
  teachers in the app.
- **Web:** GitHub repo `TennisBoy/french-quiz-system` (private). Azure created and is linked to
  `.github/workflows/azure-static-web-apps-red-flower-08e159d10.yml` (secret
  `AZURE_STATIC_WEB_APPS_API_TOKEN_RED_FLOWER_08E159D10`). It builds `web/` to `dist` with repo
  variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Pushes to `main` deploy to
  production; PRs get preview environments, which share the production Supabase project.
- **Free-tier caveat:** free Supabase projects pause after about a week of inactivity and have no
  automatic backups.
- **Privacy:** this stores student data outside board systems, so approval under MFIPPA (or the
  school board's equivalent) is needed before real use.

## Requirements from the teacher (in the transcript)

- Student emails are `<studentnumber>@tdsb.ca`; teacher emails are `prenom.nom@tdsb.on.ca`.
  `@student.tdsb.on.ca` is no longer used.
- Her classes are FSF2D7-2, FSF3U7-1 and FSF3U7-2. She must be able to add classes and add
  assignments for other classes later.
- No answers or hints may be shown before the student submits.
