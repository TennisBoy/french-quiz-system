# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A homework app for a TDSB French class. Students sign in, do an assignment (auto-graded where
possible), and submit. The teacher sees every student's answers, overrides marks, comments, and
"returns" the work. Only after it is returned does the student see marks, correct answers and
explanations. UI text is French. Do not use `alert()` or `confirm()`; use in-page confirmations
(`confirmButton` in `web/src/dom.ts`).

`dropoff/` holds the original reference material (PDFs). The long one is an AI chat transcript in
which the teacher built a single-file HTML prototype and stated her requirements. The others are
printouts of that prototype. The prototype stored results in `localStorage` and kept the password
and answer key in client JS; this project replaces it.

## Commands

Run these from the repo root. Docker must be running for anything under `supabase`.

```sh
npm install && npm --prefix web install
npm run db:start          # local Supabase (applies migrations + seed.sql); prints URL and keys
npm run db:reset          # re-apply migrations + seed after editing SQL
npm run db:test           # pgTAP tests in supabase/tests/database (needs a fresh db:reset; tests rely on seed data)
npm run functions:serve   # Edge Functions locally (copy supabase/functions/.env.example to .env first)
npm run dev               # frontend at http://localhost:5173 (copy web/.env.example to web/.env.local first)
npm run build             # type-check + build web/ to web/dist
deno test supabase/functions/_shared   # Edge Function unit tests (needs Deno installed)
```

The Supabase CLI is a dev dependency, so run it as `npx supabase ...`. Local seed logins all use the
password `motdepasse123`: `fiona.stewart@tdsb.on.ca` (teacher), and the students `100000001@tdsb.ca`
and `100000002@tdsb.ca` (FSF2D7-2) and `100000003@tdsb.ca` (FSF3U7-1). Local Studio runs at
http://127.0.0.1:54323.

## Architecture

```
web/ (Vite + TS, static)  ── hosted on Azure Static Web Apps Free; holds no secrets
  │  supabase-js with the public anon key + the user's JWT
  ├─► Supabase Auth: email + password, public sign-up DISABLED
  ├─► Postgres via PostgREST: all access enforced by RLS + SECURITY DEFINER RPCs
  └─► Edge Functions (service-role key): only for auth-admin operations
```

Azure only serves files. After the page loads, every request goes from the browser to Supabase.

### Database (`supabase/migrations/`)

- **Tables:** `classes`, `profiles` (1:1 with `auth.users`, holds `role` and `class_id`),
  `assignments` (+ `assignment_classes`, many-to-many), `answer_keys` (one row per assignment,
  separate so students can never select it), and `submissions` (unique per student and assignment).
- **Content is data.** `assignments.content` is `{sections:[{id,title,instructions,questions:[{id,
  type:"choice"|"text",prompt,context?,options?,points?}]}]}`. `answer_keys.key` maps each question
  id to `{correct:<option index>}` or `{accept:[...]}`, plus `explanation`. New assignments and
  classes are rows; there is no authoring UI yet (use Studio or SQL).
- **Every write that matters goes through an RPC.** Students and the teacher never insert or update
  `submissions` directly:
  - `submit_assignment` grades on the server. Choice answers are compared by original option index;
    text answers are normalized (`private.normalize_answer`: case, spaces, apostrophes, trailing
    period; accents kept). Matches are `correct`. Any other non-empty text is `review`, never
    `incorrect`.
  - `grade_submission` / `return_submissions`: teacher only. Bulk return skips work with questions
    still marked `review`.
  - `my_submissions` / `my_submission_detail`: the student's view. They hide marks, comments and the
    key until `status = 'returned'`.
- **Scores are computed by a trigger** (`private.compute_submission_score`) from `auto_results`
  overlaid with `teacher_marks`. Never accept a score from the client.
- **Helpers live in schema `private`** (`is_teacher()`, `my_class_id()`), which PostgREST does not
  expose. RLS policies call them.
- **Profile lifecycle.** `on_auth_user_created` inserts a bare student profile. GoTrue writes
  `app_metadata` after the insert, so the trigger cannot read it; `create-students` fills in
  names, class and `must_change_password` with a follow-up update. `on_auth_user_password_changed`
  clears `must_change_password`. That is why `reset-password` sets the flag *after* changing the
  password.
- **The teacher account** is created manually (Auth dashboard) and promoted with
  `update profiles set role = 'teacher' where email = ...`. Nothing in the app can make a teacher.

### Edge Functions (`supabase/functions/`)

`create-students` (bulk accounts with generated temporary passwords, returned once) and
`reset-password`. Both go through `_shared/auth.ts` `requireTeacher()`. Keep anything that does not
need the auth admin API in SQL instead. Note that the local gateway answers CORS with `*`; the
function's `ALLOWED_ORIGINS` echo only matters on the hosted project.

### Frontend (`web/src/`)

A small history-API router (`router.ts`) with route guards for session, role and forced password
change, and one module per page in `pages/`. Build every DOM node with `el()` from `dom.ts`. Never
use `innerHTML`: student answers are rendered on the teacher's screen, so injected HTML would run
as the teacher. The CSP in `web/public/staticwebapp.config.json` also blocks inline scripts and
styles; keep it that way. CSV export goes through `csvCell()`, which defuses formula injection.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are baked in at build time. A build without them
tree-shakes the whole app down to the "missing config" error (a ~9 KB bundle).

## Deployment

- **Supabase:** create the project in region `ca-central-1`. Run `npx supabase link` and
  `npx supabase db push` (never run `seed.sql` there). Then `npx supabase functions deploy`, and
  `npx supabase secrets set ALLOWED_ORIGINS=https://<app>.azurestaticapps.net STUDENT_EMAIL_DOMAIN=tdsb.ca`.
  In the dashboard, disable sign-ups and add the SWA URL under Auth → URL configuration.
- **Web:** `.github/workflows/azure-static-web-apps.yml` (secret
  `AZURE_STATIC_WEB_APPS_API_TOKEN`, repo vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`).
- **Free-tier caveat:** free Supabase projects pause after about a week of inactivity and have no
  automatic backups.
- **Privacy:** this stores student data outside TDSB systems, so TDSB approval under MFIPPA is
  needed before real use.

## Requirements from the teacher (in the transcript)

- Student emails are `<studentnumber>@tdsb.ca`; teacher emails are `prenom.nom@tdsb.on.ca`.
  `@student.tdsb.on.ca` is no longer used.
- The classes are FSF2D7-2, FSF3U7-1 and FSF3U7-2. She must be able to add classes and add
  assignments for other classes later.
- No answers or hints may be shown before the student submits.
