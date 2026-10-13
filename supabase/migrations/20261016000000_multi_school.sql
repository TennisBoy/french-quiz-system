-- Multi-school, multi-teacher tenancy.
--
--   schools ─┬─ school_members (user, role: admin | teacher | student)   one row per person per school
--            ├─ classes ─┬─ class_teachers (teacher)                    co-teaching allowed
--            │           ├─ enrollments (student)                       a student may be in several classes
--            │           └─ class_assignments (assignment, is_open, due_at)
--            └─ assignments (owner) ── answer_keys
--   submissions (assignment, student, class)   the class the work was submitted through
--
-- Access is decided by membership, never by a global role:
--   * a school admin manages everything in their school;
--   * a teacher manages the classes they teach, and the assignments they own;
--   * a student sees only the classes they are enrolled in and what is issued to them.
-- Creating schools and admins is a platform operation (SQL / service role); see CLAUDE.md.
--
-- Existing data (single teacher, single school) is moved into one school called "École principale":
-- teachers become its admins and teach every class; students are enrolled in their old class.

-- ---------------------------------------------------------------------------
-- New types and tables
-- ---------------------------------------------------------------------------

create type public.school_role as enum ('admin', 'teacher', 'student');

create table public.schools (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (btrim(name) <> ''),
  -- Accounts created in this school must use these domains (e.g. tdsb.ca / tdsb.on.ca).
  student_email_domain text not null check (student_email_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  staff_email_domain   text not null check (staff_email_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  created_at           timestamptz not null default now()
);

create table public.school_members (
  school_id  uuid not null references public.schools (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.school_role not null,
  created_at timestamptz not null default now(),
  primary key (school_id, user_id)
);
create index school_members_user_idx on public.school_members (user_id);

create table public.class_teachers (
  class_id   uuid not null references public.classes (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, teacher_id)
);
create index class_teachers_teacher_idx on public.class_teachers (teacher_id);

create table public.enrollments (
  class_id   uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, student_id)
);
create index enrollments_student_idx on public.enrollments (student_id);

alter table public.classes add column school_id uuid references public.schools (id) on delete cascade;

-- How the person is addressed in the app, e.g. 'Ms.' or 'Mme' → "Ms. Stewart". Null = full name.
alter table public.profiles add column honorific text check (honorific is null or btrim(honorific) <> '');

alter table public.assignments
  add column school_id  uuid references public.schools (id) on delete cascade,
  add column owner_id   uuid references public.profiles (id) on delete set null,
  add column updated_at timestamptz not null default now();

alter table public.assignment_classes rename to class_assignments;
alter table public.class_assignments rename constraint assignment_classes_pkey to class_assignments_pkey;
alter table public.class_assignments rename constraint assignment_classes_assignment_id_fkey to class_assignments_assignment_id_fkey;
alter table public.class_assignments rename constraint assignment_classes_class_id_fkey to class_assignments_class_id_fkey;
alter table public.class_assignments
  add column is_open    boolean not null default true,
  add column due_at     timestamptz,
  add column created_at timestamptz not null default now();
create index class_assignments_class_idx on public.class_assignments (class_id);

alter table public.submissions
  add column class_id  uuid references public.classes (id) on delete restrict,
  add column graded_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Move existing data into one school
-- ---------------------------------------------------------------------------

do $$
declare
  v_school uuid;
begin
  if not exists (select 1 from public.profiles) and not exists (select 1 from public.classes) then
    return; -- fresh database (local reset): seed.sql creates the schools
  end if;

  insert into public.schools (name, student_email_domain, staff_email_domain)
  values ('École principale', 'tdsb.ca', 'tdsb.on.ca')
  returning id into v_school;

  update public.classes set school_id = v_school;
  update public.assignments
  set school_id = v_school,
      owner_id = (select id from public.profiles where role = 'teacher' order by created_at limit 1);

  insert into public.school_members (school_id, user_id, role)
  select v_school, id, case when role = 'teacher' then 'admin' else 'student' end::public.school_role
  from public.profiles;

  insert into public.class_teachers (class_id, teacher_id)
  select c.id, p.id from public.classes c cross join public.profiles p where p.role = 'teacher';

  insert into public.enrollments (class_id, student_id)
  select class_id, id from public.profiles where role = 'student' and class_id is not null;

  update public.class_assignments ca
  set is_open = a.is_open, due_at = a.due_at
  from public.assignments a
  where a.id = ca.assignment_id;

  -- The class each submission came through: the student's class that has the assignment,
  -- else any class that has it.
  update public.submissions s
  set class_id = coalesce(
    (select e.class_id from public.enrollments e
     join public.class_assignments ca on ca.class_id = e.class_id and ca.assignment_id = s.assignment_id
     where e.student_id = s.student_id limit 1),
    (select ca.class_id from public.class_assignments ca where ca.assignment_id = s.assignment_id limit 1));

  if exists (select 1 from public.submissions where class_id is null) then
    raise exception 'Some submissions have no class to attach to; fix them before migrating';
  end if;
end;
$$;

alter table public.classes alter column school_id set not null;
alter table public.classes drop constraint classes_code_key;
alter table public.classes add constraint classes_school_code_key unique (school_id, code);

alter table public.assignments alter column school_id set not null;
create index assignments_school_idx on public.assignments (school_id);
create index assignments_owner_idx on public.assignments (owner_id);

alter table public.submissions alter column class_id set not null;
create index submissions_class_assignment_idx on public.submissions (class_id, assignment_id);
create index submissions_graded_by_idx on public.submissions (graded_by);

-- ---------------------------------------------------------------------------
-- Drop the single-teacher model
-- ---------------------------------------------------------------------------

drop policy "classes: read" on public.classes;
drop policy "classes: teacher writes" on public.classes;
drop policy "profiles: read own or teacher" on public.profiles;
drop policy "profiles: teacher updates" on public.profiles;
drop policy "assignments: read for my class or teacher" on public.assignments;
drop policy "assignments: teacher writes" on public.assignments;
drop policy "assignment_classes: read" on public.class_assignments;
drop policy "assignment_classes: teacher writes" on public.class_assignments;
drop policy "answer_keys: teacher only" on public.answer_keys;
drop policy "submissions: teacher reads" on public.submissions;
drop policy "submissions: teacher deletes" on public.submissions;

drop function public.my_submissions();
drop function public.grade_submission(uuid, jsonb, jsonb, text, boolean);
drop function public.return_submissions(uuid, uuid);
drop function public.save_assignment(uuid, text, text, jsonb, jsonb, uuid[], boolean, timestamptz, boolean, boolean);
drop function private.is_teacher();
drop function private.my_class_id();

alter table public.assignments drop column is_open, drop column due_at;
drop index public.profiles_class_idx;
alter table public.profiles drop column class_id, drop column role;
drop type public.user_role;

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anon, nothing executable by default
-- ---------------------------------------------------------------------------

-- The app has no anonymous features. RLS already hid every row from anon; now anon cannot even
-- reach the tables or functions. Supabase grants anon/PUBLIC access to new objects through
-- database-wide default privileges, which a per-schema setting cannot take back, so these are global.
-- Functions are revoked again at the end of this file, after they are created.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges revoke all on tables from anon;
alter default privileges revoke all on sequences from anon;
alter default privileges revoke execute on functions from anon, public;

-- ---------------------------------------------------------------------------
-- Membership helpers (schema private, not exposed by PostgREST)
-- ---------------------------------------------------------------------------
-- Set-returning and argument-free so policies can use `x in (select private.fn())`, which Postgres
-- evaluates once per query instead of once per row. SECURITY DEFINER so they read membership
-- tables without recursing through RLS.

create function private.my_school_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select school_id from public.school_members where user_id = (select auth.uid());
$$;

create function private.my_staff_school_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select school_id from public.school_members
  where user_id = (select auth.uid()) and role in ('admin', 'teacher');
$$;

create function private.my_admin_school_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select school_id from public.school_members where user_id = (select auth.uid()) and role = 'admin';
$$;

-- Classes the caller teaches, plus every class of the schools they administer.
create function private.my_taught_class_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select class_id from public.class_teachers where teacher_id = (select auth.uid())
  union
  select id from public.classes
  where school_id in (select school_id from public.school_members
                      where user_id = (select auth.uid()) and role = 'admin');
$$;

create function private.my_enrolled_class_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select class_id from public.enrollments where student_id = (select auth.uid());
$$;

-- Assignments issued to a class the caller is enrolled in.
create function private.my_student_assignment_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select ca.assignment_id from public.class_assignments ca
  join public.enrollments e on e.class_id = ca.class_id
  where e.student_id = (select auth.uid());
$$;

-- Everyone who belongs to a school where the caller is staff.
create function private.my_school_people_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id from public.school_members m
  where m.school_id in (select school_id from public.school_members
                        where user_id = (select auth.uid()) and role in ('admin', 'teacher'));
$$;

grant execute on function
  private.my_school_ids(), private.my_staff_school_ids(), private.my_admin_school_ids(),
  private.my_taught_class_ids(), private.my_enrolled_class_ids(), private.my_student_assignment_ids(),
  private.my_school_people_ids()
to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Writes that need validation or touch several tables go through the RPCs below; tables only get
-- the direct write policies the UI actually uses.

alter table public.schools        enable row level security;
alter table public.school_members enable row level security;
alter table public.class_teachers enable row level security;
alter table public.enrollments    enable row level security;

create policy "schools: members read" on public.schools
  for select to authenticated using (id in (select private.my_school_ids()));
create policy "schools: admins update" on public.schools
  for update to authenticated
  using (id in (select private.my_admin_school_ids()))
  with check (id in (select private.my_admin_school_ids()));

-- Memberships are created by the create-accounts Edge Function (service role).
create policy "school_members: own or staff read" on public.school_members
  for select to authenticated
  using (user_id = (select auth.uid()) or school_id in (select private.my_staff_school_ids()));

create policy "profiles: own or school staff read" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or id in (select private.my_school_people_ids()));

create policy "classes: staff or enrolled read" on public.classes
  for select to authenticated
  using (school_id in (select private.my_staff_school_ids()) or id in (select private.my_enrolled_class_ids()));
create policy "classes: teachers update" on public.classes
  for update to authenticated
  using (id in (select private.my_taught_class_ids()))
  with check (id in (select private.my_taught_class_ids()));

create policy "class_teachers: staff read" on public.class_teachers
  for select to authenticated
  using (class_id in (select id from public.classes where school_id in (select private.my_staff_school_ids())));
create policy "class_teachers: admins manage" on public.class_teachers
  for all to authenticated
  using (class_id in (select id from public.classes where school_id in (select private.my_admin_school_ids())))
  with check (
    class_id in (select id from public.classes where school_id in (select private.my_admin_school_ids()))
    and exists (
      select 1 from public.school_members m join public.classes c on c.school_id = m.school_id
      where c.id = class_id and m.user_id = teacher_id and m.role in ('admin', 'teacher')
    )
  );

create policy "enrollments: own or teacher read" on public.enrollments
  for select to authenticated
  using (student_id = (select auth.uid()) or class_id in (select private.my_taught_class_ids()));
create policy "enrollments: teachers add" on public.enrollments
  for insert to authenticated
  with check (
    class_id in (select private.my_taught_class_ids())
    and exists (
      select 1 from public.school_members m join public.classes c on c.school_id = m.school_id
      where c.id = class_id and m.user_id = student_id and m.role = 'student'
    )
  );
create policy "enrollments: teachers move" on public.enrollments
  for update to authenticated
  using (class_id in (select private.my_taught_class_ids()))
  with check (
    class_id in (select private.my_taught_class_ids())
    and exists (
      select 1 from public.school_members m join public.classes c on c.school_id = m.school_id
      where c.id = class_id and m.user_id = student_id and m.role = 'student'
    )
  );
create policy "enrollments: teachers remove" on public.enrollments
  for delete to authenticated using (class_id in (select private.my_taught_class_ids()));

create policy "assignments: staff or issued read" on public.assignments
  for select to authenticated
  using (school_id in (select private.my_staff_school_ids()) or id in (select private.my_student_assignment_ids()));
create policy "assignments: owner or admin delete" on public.assignments
  for delete to authenticated
  using (owner_id = (select auth.uid()) or school_id in (select private.my_admin_school_ids()));

create policy "answer_keys: staff read" on public.answer_keys
  for select to authenticated
  using (assignment_id in (select id from public.assignments where school_id in (select private.my_staff_school_ids())));

create policy "class_assignments: teacher or enrolled read" on public.class_assignments
  for select to authenticated
  using (class_id in (select private.my_taught_class_ids()) or class_id in (select private.my_enrolled_class_ids()));
create policy "class_assignments: teachers update" on public.class_assignments
  for update to authenticated
  using (class_id in (select private.my_taught_class_ids()))
  with check (class_id in (select private.my_taught_class_ids()));
create policy "class_assignments: teachers remove" on public.class_assignments
  for delete to authenticated using (class_id in (select private.my_taught_class_ids()));

create policy "submissions: teachers read" on public.submissions
  for select to authenticated using (class_id in (select private.my_taught_class_ids()));
create policy "submissions: teachers delete" on public.submissions
  for delete to authenticated using (class_id in (select private.my_taught_class_ids()));

-- ---------------------------------------------------------------------------
-- Fix from `supabase db lint`: grading calls STABLE functions (jsonb_build_object), so it cannot be
-- IMMUTABLE. Same body otherwise.
-- ---------------------------------------------------------------------------

create or replace function private.grade_answers(p_content jsonb, p_key jsonb, p_answers jsonb)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_results jsonb := '{}'::jsonb;
  v_answer  jsonb;
  v_qkey    jsonb;
  v_mark    text;
  q         record;
begin
  for q in select * from private.assignment_questions(p_content) loop
    v_answer := p_answers -> q.question_id;
    v_qkey   := p_key -> q.question_id;

    if v_answer is null or v_answer = 'null'::jsonb or btrim(v_answer #>> '{}') = '' then
      v_mark := 'incorrect';
    elsif v_qkey is null then
      v_mark := 'review';
    elsif q.qtype = 'choice' then
      v_mark := case when (v_answer #>> '{}') = (v_qkey ->> 'correct') then 'correct' else 'incorrect' end;
    else
      v_mark := case
        when exists (
          select 1 from jsonb_array_elements_text(coalesce(v_qkey -> 'accept', '[]')) a
          where private.normalize_answer(a) = private.normalize_answer(v_answer #>> '{}')
        ) then 'correct'
        else 'review'
      end;
    end if;

    v_results := v_results || jsonb_build_object(q.question_id, v_mark);
  end loop;
  return v_results;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: who am I
-- ---------------------------------------------------------------------------

-- { profile, memberships: [{ school_id, school_name, role }] } for the signed-in user, or null.
create function public.my_context()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id, 'email', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
      'honorific', p.honorific, 'must_change_password', p.must_change_password),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('school_id', s.id, 'school_name', s.name, 'role', m.role) order by s.name)
      from public.school_members m join public.schools s on s.id = m.school_id
      where m.user_id = p.id), '[]'::jsonb))
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- Classes the caller teaches (all classes of schools they administer), with the school name.
create function public.my_classes()
returns table (id uuid, school_id uuid, school_name text, code text, name text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.school_id, s.name, c.code, c.name
  from public.classes c join public.schools s on s.id = c.school_id
  where c.id in (select private.my_taught_class_ids())
  order by s.name, c.code;
$$;

-- ---------------------------------------------------------------------------
-- RPC: teacher creates a class (and becomes its teacher)
-- ---------------------------------------------------------------------------

create function public.create_class(p_school_id uuid, p_code text, p_name text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_school_id not in (select private.my_staff_school_ids()) then
    raise exception 'Réservé au personnel de l''école' using errcode = '42501';
  end if;
  if coalesce(btrim(p_code), '') = '' then
    raise exception 'Le code de la classe est requis' using errcode = '22023';
  end if;

  begin
    insert into public.classes (school_id, code, name)
    values (p_school_id, btrim(p_code), nullif(btrim(coalesce(p_name, '')), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ce code de classe existe déjà' using errcode = '23505';
  end;

  insert into public.class_teachers (class_id, teacher_id) values (v_id, (select auth.uid()));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: student
-- ---------------------------------------------------------------------------

-- One row per assignment issued to the caller's classes, with their submission summary. Score is
-- hidden until the work is returned unless the assignment shows it on submit.
create function public.my_assignments()
returns table (
  assignment_id uuid, title text, class_code text, is_open boolean, due_at timestamptz,
  status public.submission_status, submitted_at timestamptz, returned_at timestamptz,
  score numeric, max_score numeric
)
language sql stable security definer set search_path = ''
as $$
  select distinct on (a.id)
         a.id, a.title, c.code, ca.is_open, ca.due_at,
         s.status, s.submitted_at, s.returned_at,
         case when s.status = 'returned' or a.show_score_on_submit then s.score end,
         case when s.status = 'returned' or a.show_score_on_submit then s.max_score end
  from public.enrollments e
  join public.class_assignments ca on ca.class_id = e.class_id
  join public.assignments a on a.id = ca.assignment_id
  join public.classes c on c.id = e.class_id
  left join public.submissions s on s.assignment_id = a.id and s.student_id = e.student_id
  where e.student_id = (select auth.uid())
  order by a.id, ca.is_open desc;
$$;

create or replace function public.submit_assignment(p_assignment_id uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_assignment public.assignments;
  v_issue      public.class_assignments;
  v_results    jsonb;
  v_sub        public.submissions;
begin
  if v_uid is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;

  -- The class the student takes this assignment through (an open one first).
  select ca.* into v_issue
  from public.class_assignments ca
  join public.enrollments e on e.class_id = ca.class_id and e.student_id = v_uid
  where ca.assignment_id = p_assignment_id
  order by ca.is_open desc
  limit 1;
  if not found then
    raise exception 'Devoir introuvable pour votre classe' using errcode = 'P0002';
  end if;
  if not v_issue.is_open then
    raise exception 'Ce devoir est fermé' using errcode = '42501';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Format de réponses invalide' using errcode = '22023';
  end if;

  select * into v_assignment from public.assignments where id = p_assignment_id;
  v_results := private.grade_answers(
    v_assignment.content,
    (select key from public.answer_keys where assignment_id = p_assignment_id),
    p_answers);

  begin
    insert into public.submissions (assignment_id, student_id, class_id, answers, auto_results)
    values (p_assignment_id, v_uid, v_issue.class_id, p_answers, v_results)
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
-- RPC: teachers grade and return
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
      graded_by = (select auth.uid()),
      returned_at = case when p_return then now() else null end
  where s.id = p_submission_id
    and s.class_id in (select private.my_taught_class_ids())
  returning * into v_sub;

  if not found then
    raise exception 'Remise introuvable' using errcode = 'P0002';
  end if;
  return v_sub;
end;
$$;

-- Returns every submission for an assignment in the caller's classes (or one class) that has no
-- question still waiting for review. Returns how many were returned and how many were skipped.
create function public.return_submissions(p_assignment_id uuid, p_class_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_returned int;
  v_skipped  int;
begin
  if p_class_id is not null and p_class_id not in (select private.my_taught_class_ids()) then
    raise exception 'Réservé aux enseignants de la classe' using errcode = '42501';
  end if;

  with candidates as (
    select s.id,
           exists (
             select 1 from jsonb_each_text(s.auto_results || s.teacher_marks) m where m.value = 'review'
           ) as pending
    from public.submissions s
    where s.assignment_id = p_assignment_id
      and s.status <> 'returned'
      and s.class_id in (select private.my_taught_class_ids())
      and (p_class_id is null or s.class_id = p_class_id)
  ), upd as (
    update public.submissions s
    set status = 'returned', returned_at = now(), graded_at = coalesce(s.graded_at, now()),
        graded_by = coalesce(s.graded_by, (select auth.uid()))
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
-- RPC: teachers write assignments
-- ---------------------------------------------------------------------------

-- Checks the content shape the student page and grading rely on. Returns the key with entries for
-- removed questions dropped. Raises 22023 with a French message on the first problem.
create function private.validate_assignment(p_title text, p_content jsonb, p_key jsonb)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_ids  text[];
  v_opts jsonb;
  v_k    jsonb;
  v_key  jsonb;
  q      jsonb;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Le titre est requis' using errcode = '22023';
  end if;
  if jsonb_typeof(p_content -> 'sections') is distinct from 'array'
     or jsonb_array_length(p_content -> 'sections') = 0 then
    raise exception 'Ajoutez au moins une section' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_content -> 'sections') s
    where jsonb_typeof(s) is distinct from 'object'
       or jsonb_typeof(s -> 'questions') is distinct from 'array'
       or jsonb_array_length(s -> 'questions') = 0
  ) then
    raise exception 'Chaque section doit contenir au moins une question' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_key, '{}')) is distinct from 'object' then
    raise exception 'Format de corrigé invalide' using errcode = '22023';
  end if;

  select array_agg(question_id) into v_ids from private.assignment_questions(p_content);
  if exists (select 1 from unnest(v_ids) i where coalesce(i, '') = '')
     or cardinality(v_ids) <> (select count(distinct i) from unnest(v_ids) i) then
    raise exception 'Identifiants de question manquants ou en double' using errcode = '22023';
  end if;

  for q in select qu from jsonb_array_elements(p_content -> 'sections') s, jsonb_array_elements(s -> 'questions') qu loop
    if coalesce(btrim(q ->> 'prompt'), '') = '' then
      raise exception 'Chaque question doit avoir un énoncé' using errcode = '22023';
    end if;
    if q ? 'points' and (jsonb_typeof(q -> 'points') <> 'number' or (q ->> 'points')::numeric <= 0) then
      raise exception 'Les points doivent être un nombre positif' using errcode = '22023';
    end if;
    v_k := coalesce(p_key, '{}') -> (q ->> 'id');

    if q ->> 'type' = 'choice' then
      v_opts := q -> 'options';
      if jsonb_typeof(v_opts) is distinct from 'array' or jsonb_array_length(v_opts) < 2
         or exists (select 1 from jsonb_array_elements(v_opts) o
                    where jsonb_typeof(o) <> 'string' or btrim(o #>> '{}') = '') then
        raise exception 'Question « % » : il faut au moins deux choix, tous remplis', q ->> 'prompt'
          using errcode = '22023';
      end if;
      if jsonb_typeof(v_k -> 'correct') is distinct from 'number'
         or (v_k ->> 'correct')::numeric not in (select generate_series(0, jsonb_array_length(v_opts) - 1)) then
        raise exception 'Question « % » : indiquez la bonne réponse', q ->> 'prompt' using errcode = '22023';
      end if;
    elsif q ->> 'type' = 'text' then
      if v_k ? 'accept' and jsonb_typeof(v_k -> 'accept') <> 'array' then
        raise exception 'Format de corrigé invalide' using errcode = '22023';
      end if;
    else
      raise exception 'Type de question inconnu' using errcode = '22023';
    end if;
  end loop;

  select coalesce(jsonb_object_agg(k, v), '{}') into v_key
  from jsonb_each(coalesce(p_key, '{}')) e(k, v)
  where k = any (v_ids);
  return v_key;
end;
$$;

-- Creates (p_id null) or updates (p_id given) an assignment, its answer key, and its issue to the
-- caller's classes.
--   p_school_id: the assignment's school (an existing assignment cannot change school).
--   p_classes:   [{ "class_id", "is_open"?, "due_at"? }] — the caller's classes that get it. Classes
--                the caller does not teach are left as they are (a co-teacher's issue is not removed).
-- Only the owner or a school admin may update. Existing submissions are re-scored (the trigger runs
-- on update); with p_regrade their auto_results are redone with the new key. Teacher marks are kept.
create function public.save_assignment(
  p_school_id uuid,
  p_title text,
  p_description text,
  p_content jsonb,
  p_key jsonb,
  p_classes jsonb default '[]',
  p_show_score_on_submit boolean default true,
  p_regrade boolean default true,
  p_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id     uuid := p_id;
  v_school uuid;
  v_key    jsonb;
  v_issue  record;
begin
  if p_school_id is null or p_school_id not in (select private.my_staff_school_ids()) then
    raise exception 'Réservé au personnel de l''école' using errcode = '42501';
  end if;
  v_school := p_school_id;
  if p_id is not null then
    select school_id into v_school from public.assignments
    where id = p_id
      and (owner_id = (select auth.uid()) or school_id in (select private.my_admin_school_ids()));
    if not found then
      raise exception 'Devoir introuvable' using errcode = 'P0002';
    end if;
    if p_school_id <> v_school then
      raise exception 'Un devoir ne peut pas changer d''école' using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(coalesce(p_classes, '[]')) is distinct from 'array' then
    raise exception 'Format de classes invalide' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_classes, '[]')) x
    where x ->> 'class_id' is null
       or (x ->> 'class_id')::uuid not in (select private.my_taught_class_ids())
       or (x ->> 'class_id')::uuid not in (select id from public.classes where school_id = v_school)
  ) then
    raise exception 'Vous ne pouvez assigner ce devoir qu''à vos classes de cette école' using errcode = '42501';
  end if;

  v_key := private.validate_assignment(p_title, p_content, p_key);

  if v_id is null then
    insert into public.assignments (school_id, owner_id, title, description, content, show_score_on_submit)
    values (v_school, (select auth.uid()), btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
            p_content, coalesce(p_show_score_on_submit, true))
    returning id into v_id;
  else
    update public.assignments
    set title = btrim(p_title),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        content = p_content,
        show_score_on_submit = coalesce(p_show_score_on_submit, true),
        updated_at = now()
    where id = v_id;
  end if;

  insert into public.answer_keys (assignment_id, key) values (v_id, v_key)
  on conflict (assignment_id) do update set key = excluded.key;

  delete from public.class_assignments
  where assignment_id = v_id
    and class_id in (select private.my_taught_class_ids())
    and class_id not in (select (x ->> 'class_id')::uuid from jsonb_array_elements(coalesce(p_classes, '[]')) x);

  for v_issue in
    select (x ->> 'class_id')::uuid as class_id,
           coalesce((x ->> 'is_open')::boolean, true) as is_open,
           (x ->> 'due_at')::timestamptz as due_at
    from jsonb_array_elements(coalesce(p_classes, '[]')) x
  loop
    insert into public.class_assignments (assignment_id, class_id, is_open, due_at)
    values (v_id, v_issue.class_id, v_issue.is_open, v_issue.due_at)
    on conflict (assignment_id, class_id) do update set is_open = excluded.is_open, due_at = excluded.due_at;
  end loop;

  update public.submissions s
  set auto_results = case when p_regrade then private.grade_answers(p_content, v_key, s.answers) else s.auto_results end
  where s.assignment_id = v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: RPCs are for signed-in users only
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from anon, public;
revoke execute on all functions in schema private from anon, public;

grant execute on function
  public.my_context(),
  public.my_classes(),
  public.create_class(uuid, text, text),
  public.my_assignments(),
  public.submit_assignment(uuid, jsonb),
  public.my_submission_detail(uuid),
  public.grade_submission(uuid, jsonb, jsonb, text, boolean),
  public.return_submissions(uuid, uuid),
  public.save_assignment(uuid, text, text, jsonb, jsonb, jsonb, boolean, boolean, uuid)
to authenticated;
