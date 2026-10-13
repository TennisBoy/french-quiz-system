# Infrastructure

How the French homework app is built, hosted, secured, deployed and run. This is the human guide;
`CLAUDE.md` is the shorter reference for working on the code.

## 1. The big picture

```
                 ┌───────────────────────────────────────────────┐
  Browser ──────►│ Azure Static Web Apps (Free)                  │  serves the website files only
  (student or    │ red-flower-08e159d10.6.azurestaticapps.net    │  (HTML, JS, CSS). No data, no secrets.
   teacher)      └───────────────────────────────────────────────┘
     │
     │  after the page loads, every request goes straight to Supabase
     ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ Supabase project cgwvacojkzatinvyktcx, region ca-central-1 (Canada)  │
  │                                                                      │
  │  Auth ............ email + password sign-in; public sign-up is OFF   │
  │  Postgres ........ all data; every row protected by row-level security│
  │  PostgREST/RPC ... the API the website calls (generated from the DB)  │
  │  Edge Functions .. create-accounts, reset-password (need admin rights)│
  └──────────────────────────────────────────────────────────────────────┘

  GitHub TennisBoy/french-quiz-system (private)
    ├─ Checks workflow ........ lint, build, database tests on every PR
    └─ Azure SWA workflow ..... builds web/ and deploys it (main = production)
```

There is no server of our own. Azure hosts static files; Supabase is the backend. That keeps cost at
zero on the free tiers and leaves nothing to patch.

## 2. The pieces

| Piece | What it does | Where it is configured |
|---|---|---|
| **Website** (`web/`) | Vite + TypeScript single-page app, French UI. Talks to Supabase with the public key and the signed-in user's token. | `web/src/`, built to `web/dist/` |
| **Azure Static Web Apps (Free)** | Serves `web/dist` worldwide over HTTPS. Sends every unknown path to `index.html` (so links like `/enseignant/devoirs` work) and adds security headers. | `web/public/staticwebapp.config.json`, `.github/workflows/azure-static-web-apps-red-flower-08e159d10.yml` |
| **Supabase Auth** | Accounts and sign-in. Nobody can sign themselves up; accounts are created by teachers and school admins. | Supabase dashboard → Authentication |
| **Supabase Postgres** | All data: schools, people, classes, assignments, answer keys, submissions. | `supabase/migrations/*.sql` |
| **Edge Functions** (Deno) | The two jobs that need the Auth admin API: creating accounts and resetting passwords. | `supabase/functions/`, dependency versions in `supabase/functions/deno.json` |
| **GitHub Actions** | `Checks` runs the full test/lint gate on every PR and on `main`. The Azure workflow builds and deploys the site. | `.github/workflows/` |

## 3. How a request flows

**Signing in.** The browser sends email + password to Supabase Auth and gets back a short-lived
token (JWT). The website then calls `my_context()`, which returns the person's profile and their
role in each school. Teachers and admins land on *Résultats*; students on *Mes devoirs*. If the
account still has a temporary password, the site forces a password change first.

**A student does homework.**
1. The student list comes from `my_assignments()`: only assignments issued to the student's classes.
2. The assignment page loads the questions. The answer key is in a separate table students cannot
   read, so answers never reach the browser before submitting.
3. Answers are saved as a draft in the browser while the student works.
4. *Remettre* calls `submit_assignment()`. The **database** marks it: multiple choice by option,
   written answers by comparing with the accepted answers (ignoring case, spaces, apostrophes and a
   final period, but not accents). A written answer that does not match goes to the teacher as
   "à corriger"; it is never marked wrong automatically. The score is computed by the database,
   never sent by the browser.

**The teacher marks and returns.**
1. *Résultats* lists the students of a class the teacher teaches and their submissions.
2. Opening a submission shows each answer next to the correct one. The teacher can override marks
   and add comments (`grade_submission()`).
3. *Enregistrer et retourner*, or *Retourner tout* for the whole class (`return_submissions()`,
   which skips work that still has answers "à corriger").
4. Only now does the student see marks, correct answers, explanations and comments.

## 4. Data model

Everything belongs to a **school**, so many schools and teachers can share one installation
without seeing each other's data.

```
schools ─┬─ school_members   (person + role in this school: admin | teacher | student)
         ├─ classes ─┬─ class_teachers     (who teaches the class; several teachers allowed)
         │           ├─ enrollments        (which students are in it; a student can be in several)
         │           └─ class_assignments  (an assignment given to this class: open/closed, due date)
         └─ assignments (owner) ── answer_keys (correct answers + explanations)
submissions (one per student per assignment; records the class and who graded it)
profiles (name, email, title such as "Mme", must-change-password flag; 1:1 with the Auth account)
```

| Role | Can do |
|---|---|
| **School admin** | Everything a teacher can, for every class in the school; create teacher accounts; reset teacher passwords. |
| **Teacher** | Create classes; add students to and move them between their classes; create and edit their own assignments; view and duplicate colleagues' assignments; see, mark and return work from their classes; reset their students' passwords. |
| **Student** | See and submit assignments given to their classes; see results once returned. |

Questions and answers are stored as data (JSON), so new assignments and classes need no code
changes. Teachers build assignments on the *Devoirs* page.

## 5. Security

- **Row-level security on every table.** The database itself decides what each person may read or
  change, based on their school and class memberships. A bug in the website cannot leak data the
  database would refuse to return. An automated test fails if any table lacks it.
- **Important writes go through database functions** (`save_assignment`, `submit_assignment`,
  `grade_submission`, ...) that check who is calling and validate the input.
- **Anonymous visitors can reach nothing**: no table and no function, including ones added later.
- **Keys.** The *publishable* key (`sb_publishable_…`) is built into the website and is meant to be
  public; on its own it grants nothing. The *service role* key bypasses all security and exists only
  inside the Edge Functions on Supabase. It must never be put in `web/`, in GitHub variables, or in
  chat.
- **Accounts.** Public sign-up is disabled. New accounts get a random temporary password
  (e.g. `k7mq-x3pa-9fte`), shown once to the teacher, and must choose their own at first sign-in.
  Email domains are enforced per school (`tdsb.ca` for students, `tdsb.on.ca` for staff).
- **Website hardening.** The page never inserts HTML strings (a student's answer is shown on the
  teacher's screen, so HTML could run as the teacher); a lint rule enforces this. The
  Content-Security-Policy header only allows scripts from the site itself and connections to
  Supabase. The page asks browsers not to auto-translate it. CSV exports are protected against
  spreadsheet formula injection.
- **Edge Functions** only answer requests from the Azure site (`ALLOWED_ORIGINS`) and check that the
  caller teaches the class or administers the school before acting.

## 6. Environments

| Environment | Website | Database | Notes |
|---|---|---|---|
| **Local** | `npm run dev` → http://localhost:5173 | Docker (`npm run db:start`), with test data from `supabase/seed.sql` | Two fake schools; all test accounts use `motdepasse123`. Safe to reset any time. |
| **PR preview** | Azure creates a temporary URL for each pull request | **The production database** | Previews are for checking the UI. Do not create test data there; it is real data. |
| **Production** | https://red-flower-08e159d10.6.azurestaticapps.net | Supabase `cgwvacojkzatinvyktcx` (Canada) | Deployed when a PR is merged into `main`. |

Configuration that is not in the code:

| Setting | Where | Value |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | GitHub → repo → Settings → Variables | Supabase URL and publishable key (public) |
| `AZURE_STATIC_WEB_APPS_API_TOKEN_RED_FLOWER_08E159D10` | GitHub → repo → Settings → Secrets | Created by Azure; lets the workflow deploy |
| `ALLOWED_ORIGINS` | Supabase → Edge Functions → Secrets | `https://red-flower-08e159d10.6.azurestaticapps.net` |
| Sign-up disabled, Site URL | Supabase dashboard → Authentication | Off; the Azure URL |

## 7. Making a change and deploying it

1. Work on a branch, never on `main`.
2. Run `npm run check` locally (Docker running). It lints the website and functions, finds unused
   code, builds, lints the database, checks the generated types match the schema, and runs the
   database and function tests.
3. Push and open a pull request. The **Checks** workflow runs the same gate; Azure builds a preview.
4. If the change includes a database migration: back it up and apply it to production first
   (`npx supabase db dump --linked --data-only -f backup.sql`, then `npx supabase db push`). If it
   changes Edge Functions: `npx supabase functions deploy`.
5. Merge the PR. Azure deploys the website to production in about a minute.

Database changes are always **new migration files**. Never edit one that has been merged: production
has already run it.

## 8. Keeping the code healthy

- **Automated gate** (`npm run check`, runs on every PR): ESLint with the project's own rules (no
  HTML strings, no browser pop-ups, no forgotten promises), TypeScript, Deno lint for the functions,
  Knip for unused files and exports, `supabase db lint`, a check that `web/src/database.types.ts`
  matches the database, 70+ database tests (including "school A cannot see school B"), and the
  function unit tests.
- **Periodic review**: run `/health-check` in Claude Code. It runs the gate, then reviews what tools
  cannot judge (security, docs that no longer match the code, broken links between layers, risky
  schema changes, code that is out of scope) and reports verified findings by severity. Anything it
  finds that a tool could catch should become a new automated check.

## 9. Costs and limits

Everything runs on free tiers today. Approximate limits (check current pricing pages before relying
on them):

| Service | Free tier | When to upgrade |
|---|---|---|
| **Supabase Free** | 500 MB database, 50,000 monthly active users, 2 projects. **Pauses after about a week without activity. No automatic backups.** | Before real classroom use: Supabase **Pro** (about US$25/month) removes pausing and adds daily backups. |
| **Azure SWA Free** | 100 GB bandwidth/month, 3 preview environments, custom domains with free HTTPS. | Only for an SLA or private networking (Standard plan). Not needed for this app. |
| **GitHub** | Private repo, Actions minutes included. | Branch protection rules (to *force* checks before merge) need a paid plan for private repos. |

About 100 people using it at the same time is light load for this setup: the website is static
files and the database work per request is small and indexed.

## 10. Privacy and compliance

- Student names, emails, answers and marks are stored in Supabase in **Canada (ca-central-1)**.
  Azure only serves the website files and stores no student data.
- This is outside school-board systems, so it needs **approval under MFIPPA** (Ontario's privacy law)
  or the equivalent for any other board before real students use it.
- Only what the app needs is collected: name, school email, class, answers, marks, comments.

## 11. Runbook

| Task | How |
|---|---|
| **Add a school** | Supabase SQL editor: `insert into schools (name, student_email_domain, staff_email_domain) values ('…', 'tdsb.ca', 'tdsb.on.ca');` Create the admin in Authentication → Users (auto-confirm), then `insert into school_members (school_id, user_id, role) values ('<school id>', '<user id>', 'admin');` and optionally `update profiles set honorific = 'Mme' where email = '…';` |
| **Add teachers** | A school admin: *Élèves et classes* → *Ajouter des enseignants*. |
| **Add students** | A teacher: *Élèves et classes* → pick the class → paste `courriel, prénom, nom` lines. Print or download the temporary passwords right away; they are shown once. |
| **Forgotten password** | Teacher (for their students) or admin (for teachers): *Réinitialiser le mot de passe*. An admin's own password: Supabase dashboard → Authentication → Users. |
| **Let a student redo work** | Open the submission → *Permettre une reprise* (deletes that submission). |
| **Project paused** | Supabase dashboard → the project → *Restore*. Takes a few minutes. |
| **Back up now** | `npx supabase db dump --linked -f schema.sql` and `npx supabase db dump --linked --data-only -f data.sql`. Keep the files out of the repo (they contain student data). |
| **Site shows "Configuration manquante"** | The GitHub variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing. Set them, then rerun the Azure workflow (`gh workflow run "Azure Static Web Apps CI/CD"`). |
| **Rotate the service role key** | Supabase → Project Settings → API keys. Only the Edge Functions use it (Supabase provides it to them); afterwards, create a test account or reset a password to confirm they still work. |
