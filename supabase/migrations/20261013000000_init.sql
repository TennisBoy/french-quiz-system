-- FRhwcheck initial schema.
--
-- Security model (see CLAUDE.md):
--   * Students never read answer_keys and never read/write submissions directly.
--     They submit through submit_assignment() and read results through my_submissions() /
--     my_submission_detail(), which hide feedback and answers until the teacher returns the work.
--   * The teacher (profiles.role = 'teacher') reads everything and grades through grade_submission().
--   * Scores are always computed by the database (trigger), never accepted from the client.

create schema if not exists private;
grant usage on schema private to authenticated;

create type public.user_role as enum ('student', 'teacher');
create type public.submission_status as enum ('submitted', 'graded', 'returned');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.classes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,          -- e.g. 'FSF2D7-2'
  name       text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text not null unique,
  first_name           text not null default '',
  last_name            text not null default '',
  role                 public.user_role not null default 'student',
  class_id             uuid references public.classes (id) on delete set null,
  must_change_password boolean not null default false,
  created_at           timestamptz not null default now()
);

-- One homework ("devoir"). content holds sections and questions WITHOUT answers:
-- { "sections": [ { "id", "title", "instructions",
--     "questions": [ { "id", "type": "choice"|"text", "prompt", "context"?, "options"?, "points"? } ] } ] }
create table public.assignments (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  description          text,
  content              jsonb not null,
  is_open              boolean not null default true,
  due_at               timestamptz,
  show_score_on_submit boolean not null default true,  -- show the auto score right after submitting
  created_at           timestamptz not null default now()
);

create table public.assignment_classes (
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  class_id      uuid not null references public.classes (id) on delete cascade,
  primary key (assignment_id, class_id)
);

-- Keyed by question id:
--   choice: { "correct": <option index>, "explanation": "..." }
--   text:   { "accept": ["...", ...],      "explanation": "..." }
create table public.answer_keys (
  assignment_id uuid primary key references public.assignments (id) on delete cascade,
  key           jsonb not null
);

-- auto_results / teacher_marks: { "<question id>": "correct" | "incorrect" | "review" }
-- (teacher_marks only uses correct/incorrect and overrides auto_results.)
create table public.submissions (
  id                uuid primary key default gen_random_uuid(),
  assignment_id     uuid not null references public.assignments (id) on delete cascade,
  student_id        uuid not null references public.profiles (id) on delete cascade,
  answers           jsonb not null,
  auto_results      jsonb not null default '{}',
  teacher_marks     jsonb not null default '{}',
  question_comments jsonb not null default '{}',
  teacher_comment   text,
  score             numeric not null default 0,
  max_score         numeric not null default 0,
  status            public.submission_status not null default 'submitted',
  submitted_at      timestamptz not null default now(),
  graded_at         timestamptz,
  returned_at       timestamptz,
  unique (assignment_id, student_id)
);

create index submissions_student_idx on public.submissions (student_id);
create index profiles_class_idx on public.profiles (class_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.is_teacher()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and role = 'teacher'
  );
$$;

create function private.my_class_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select class_id from public.profiles where id = (select auth.uid());
$$;

grant execute on function private.is_teacher(), private.my_class_id() to authenticated;

-- Lowercase, unify apostrophes, collapse whitespace, drop a trailing period. Accents are kept:
-- they matter in French spelling.
create function private.normalize_answer(t text)
returns text
language sql immutable set search_path = ''
as $$
  select regexp_replace(
           regexp_replace(lower(btrim(replace(replace(coalesce(t, ''), '’', ''''), '‘', ''''))), '\s+', ' ', 'g'),
           '\s*\.$', '');
$$;

-- Questions of an assignment, flattened: (question_id, type, points).
create function private.assignment_questions(p_content jsonb)
returns table (question_id text, qtype text, points numeric)
language sql immutable set search_path = ''
as $$
  select q ->> 'id', q ->> 'type', coalesce((q ->> 'points')::numeric, 1)
  from jsonb_array_elements(p_content -> 'sections') s,
       jsonb_array_elements(s -> 'questions') q;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Every new auth user gets a bare student profile. The create-students Edge Function then fills in
-- names, class and must_change_password (GoTrue writes app_metadata *after* the insert, so this
-- trigger cannot read it). Role is always 'student'; promote the teacher manually (see CLAUDE.md).
create function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, lower(new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Changing your password clears the "must change password" flag. The reset-password function
-- sets the flag again *after* it changes the password.
create function private.handle_password_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles set must_change_password = false where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.handle_password_change();

-- Score = points of questions whose final mark (teacher mark, else auto result) is 'correct'.
-- Questions still marked 'review' count as 0 until the teacher marks them.
create function private.compute_submission_score()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_content jsonb;
begin
  select content into v_content from public.assignments where id = new.assignment_id;

  select coalesce(sum(q.points), 0),
         coalesce(sum(q.points) filter (
           where coalesce(new.teacher_marks ->> q.question_id, new.auto_results ->> q.question_id) = 'correct'
         ), 0)
    into new.max_score, new.score
  from private.assignment_questions(v_content) q;

  return new;
end;
$$;

create trigger submissions_compute_score
  before insert or update on public.submissions
  for each row execute function private.compute_submission_score();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.classes            enable row level security;
alter table public.profiles           enable row level security;
alter table public.assignments        enable row level security;
alter table public.assignment_classes enable row level security;
alter table public.answer_keys        enable row level security;
alter table public.submissions        enable row level security;

-- classes: everyone signed in can read (needed for labels); teacher manages.
create policy "classes: read" on public.classes
  for select to authenticated using (true);
create policy "classes: teacher writes" on public.classes
  for all to authenticated using ((select private.is_teacher())) with check ((select private.is_teacher()));

-- profiles: read your own, teacher reads and edits all. Accounts are created/deleted by Edge Functions.
create policy "profiles: read own or teacher" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select private.is_teacher()));
create policy "profiles: teacher updates" on public.profiles
  for update to authenticated using ((select private.is_teacher())) with check ((select private.is_teacher()));

-- assignments: students see open-or-closed assignments given to their class; teacher manages.
create policy "assignments: read for my class or teacher" on public.assignments
  for select to authenticated using (
    (select private.is_teacher())
    or exists (
      select 1 from public.assignment_classes ac
      where ac.assignment_id = assignments.id and ac.class_id = (select private.my_class_id())
    )
  );
create policy "assignments: teacher writes" on public.assignments
  for all to authenticated using ((select private.is_teacher())) with check ((select private.is_teacher()));

create policy "assignment_classes: read" on public.assignment_classes
  for select to authenticated using (
    (select private.is_teacher()) or class_id = (select private.my_class_id())
  );
create policy "assignment_classes: teacher writes" on public.assignment_classes
  for all to authenticated using ((select private.is_teacher())) with check ((select private.is_teacher()));

-- answer_keys: teacher only. Students get explanations via my_submission_detail() after return.
create policy "answer_keys: teacher only" on public.answer_keys
  for all to authenticated using ((select private.is_teacher())) with check ((select private.is_teacher()));

-- submissions: teacher reads and can delete (to allow a redo). No direct insert/update for anyone:
-- use submit_assignment() and grade_submission().
create policy "submissions: teacher reads" on public.submissions
  for select to authenticated using ((select private.is_teacher()));
create policy "submissions: teacher deletes" on public.submissions
  for delete to authenticated using ((select private.is_teacher()));

-- ---------------------------------------------------------------------------
-- RPC: student submits
-- ---------------------------------------------------------------------------

-- p_answers: { "<question id>": <option index> | "<text>" }
create function public.submit_assignment(p_assignment_id uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_profile    public.profiles;
  v_assignment public.assignments;
  v_key        jsonb;
  v_results    jsonb := '{}';
  v_answer     jsonb;
  v_qkey       jsonb;
  v_mark       text;
  v_sub        public.submissions;
  q            record;
begin
  if v_uid is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.role is distinct from 'student' then
    raise exception 'Seuls les élèves peuvent remettre un devoir' using errcode = '42501';
  end if;

  select * into v_assignment from public.assignments where id = p_assignment_id;
  if not found or not exists (
    select 1 from public.assignment_classes
    where assignment_id = p_assignment_id and class_id = v_profile.class_id
  ) then
    raise exception 'Devoir introuvable pour votre classe' using errcode = 'P0002';
  end if;
  if not v_assignment.is_open then
    raise exception 'Ce devoir est fermé' using errcode = '42501';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Format de réponses invalide' using errcode = '22023';
  end if;

  select key into v_key from public.answer_keys where assignment_id = p_assignment_id;

  for q in select * from private.assignment_questions(v_assignment.content) loop
    v_answer := p_answers -> q.question_id;
    v_qkey   := v_key -> q.question_id;

    if v_answer is null or v_answer = 'null'::jsonb or btrim(v_answer #>> '{}') = '' then
      v_mark := 'incorrect';
    elsif v_qkey is null then
      v_mark := 'review';
    elsif q.qtype = 'choice' then
      v_mark := case when (v_answer #>> '{}') = (v_qkey ->> 'correct') then 'correct' else 'incorrect' end;
    else
      -- Text answers that match an accepted answer are correct; anything else goes to the teacher.
      v_mark := case
        when exists (
          select 1 from jsonb_array_elements_text(v_qkey -> 'accept') a
          where private.normalize_answer(a) = private.normalize_answer(v_answer #>> '{}')
        ) then 'correct'
        else 'review'
      end;
    end if;

    v_results := v_results || jsonb_build_object(q.question_id, v_mark);
  end loop;

  begin
    insert into public.submissions (assignment_id, student_id, answers, auto_results)
    values (p_assignment_id, v_uid, p_answers, v_results)
    returning * into v_sub;
  exception when unique_violation then
    raise exception 'Vous avez déjà remis ce devoir' using errcode = '23505';
  end;

  return jsonb_build_object(
    'status', v_sub.status,
    'submitted_at', v_sub.submitted_at,
    'score', case when v_assignment.show_score_on_submit then v_sub.score end,
    'max_score', case when v_assignment.show_score_on_submit then v_sub.max_score end,
    'pending_review', (select count(*) from jsonb_each_text(v_results) where value = 'review')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: student reads their own results
-- ---------------------------------------------------------------------------

-- Summary of the caller's submissions (one row per assignment they submitted).
create function public.my_submissions()
returns table (
  assignment_id uuid,
  status public.submission_status,
  submitted_at timestamptz,
  returned_at timestamptz,
  score numeric,
  max_score numeric
)
language sql stable security definer set search_path = ''
as $$
  select s.assignment_id, s.status, s.submitted_at, s.returned_at,
         case when s.status = 'returned' or a.show_score_on_submit then s.score end,
         case when s.status = 'returned' or a.show_score_on_submit then s.max_score end
  from public.submissions s
  join public.assignments a on a.id = s.assignment_id
  where s.student_id = (select auth.uid());
$$;

-- The caller's own submission. Marks, comments and the answer key (correct answers + explanations)
-- are only included once the teacher has returned it.
create function public.my_submission_detail(p_assignment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_assignment public.assignments;
  v_returned boolean;
  v_marks jsonb;
begin
  select * into v_sub from public.submissions
  where assignment_id = p_assignment_id and student_id = (select auth.uid());
  if not found then
    return null;
  end if;

  select * into v_assignment from public.assignments where id = p_assignment_id;
  v_returned := v_sub.status = 'returned';
  v_marks := v_sub.auto_results || v_sub.teacher_marks;

  return jsonb_build_object(
    'status', v_sub.status,
    'submitted_at', v_sub.submitted_at,
    'returned_at', v_sub.returned_at,
    'answers', v_sub.answers,
    'score', case when v_returned or v_assignment.show_score_on_submit then v_sub.score end,
    'max_score', case when v_returned or v_assignment.show_score_on_submit then v_sub.max_score end,
    'marks', case when v_returned then v_marks end,
    'question_comments', case when v_returned then v_sub.question_comments end,
    'teacher_comment', case when v_returned then v_sub.teacher_comment end,
    'key', case when v_returned then (select key from public.answer_keys where assignment_id = p_assignment_id) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: teacher grades and returns
-- ---------------------------------------------------------------------------

-- p_marks: { "<question id>": "correct" | "incorrect" } overrides (merged into existing overrides;
--          pass null for a question to drop its override).
-- p_question_comments: { "<question id>": "comment" } (merged the same way).
create function public.grade_submission(
  p_submission_id uuid,
  p_marks jsonb default '{}',
  p_question_comments jsonb default '{}',
  p_teacher_comment text default null,
  p_return boolean default false
)
returns public.submissions
language plpgsql security definer set search_path = ''
as $$
declare
  v_sub public.submissions;
begin
  if not private.is_teacher() then
    raise exception 'Réservé à l''enseignant' using errcode = '42501';
  end if;

  if exists (
    select 1 from jsonb_each(coalesce(p_marks, '{}'))
    where value <> 'null'::jsonb and value #>> '{}' not in ('correct', 'incorrect')
  ) then
    raise exception 'Une note doit être "correct" ou "incorrect"' using errcode = '22023';
  end if;

  update public.submissions s
  set teacher_marks = jsonb_strip_nulls(s.teacher_marks || coalesce(p_marks, '{}')),
      question_comments = jsonb_strip_nulls(s.question_comments || coalesce(p_question_comments, '{}')),
      teacher_comment = coalesce(p_teacher_comment, s.teacher_comment),
      status = case when p_return then 'returned'::public.submission_status else 'graded'::public.submission_status end,
      graded_at = now(),
      returned_at = case when p_return then now() else null end
  where s.id = p_submission_id
  returning * into v_sub;

  if not found then
    raise exception 'Remise introuvable' using errcode = 'P0002';
  end if;
  return v_sub;
end;
$$;

-- Returns every submission for an assignment (optionally one class) that has no question still
-- waiting for review. Returns how many were returned and how many were skipped.
create function public.return_submissions(p_assignment_id uuid, p_class_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_returned int;
  v_skipped int;
begin
  if not private.is_teacher() then
    raise exception 'Réservé à l''enseignant' using errcode = '42501';
  end if;

  with candidates as (
    select s.id,
           exists (
             select 1 from jsonb_each_text(s.auto_results || s.teacher_marks) m where m.value = 'review'
           ) as pending
    from public.submissions s
    join public.profiles p on p.id = s.student_id
    where s.assignment_id = p_assignment_id
      and s.status <> 'returned'
      and (p_class_id is null or p.class_id = p_class_id)
  ), upd as (
    update public.submissions s
    set status = 'returned', returned_at = now(), graded_at = coalesce(s.graded_at, now())
    from candidates c
    where s.id = c.id and not c.pending
    returning s.id
  )
  select (select count(*) from upd), (select count(*) from candidates where pending)
    into v_returned, v_skipped;

  return jsonb_build_object('returned', v_returned, 'skipped_pending_review', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: RPCs are for signed-in users only.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.submit_assignment(uuid, jsonb),
  public.my_submissions(),
  public.my_submission_detail(uuid),
  public.grade_submission(uuid, jsonb, jsonb, text, boolean),
  public.return_submissions(uuid, uuid)
from public, anon;

grant execute on function
  public.submit_assignment(uuid, jsonb),
  public.my_submissions(),
  public.my_submission_detail(uuid),
  public.grade_submission(uuid, jsonb, jsonb, text, boolean),
  public.return_submissions(uuid, uuid)
to authenticated;
