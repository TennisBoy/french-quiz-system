-- save_assignment() tests. Run with `npm run db:test` (after `npm run db:reset`; relies on seed.sql).
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

-- A valid two-question assignment, reused below.
create temp table sample as select
  '{"sections":[{"id":"s1","title":"Partie 1","questions":[
     {"id":"a","type":"choice","prompt":"Choisissez","options":["un","deux","trois"]},
     {"id":"b","type":"text","prompt":"Écrivez","points":2}]}]}'::jsonb as content,
  '{"a":{"correct":1,"explanation":"Parce que."},"b":{"accept":["se sont parlé"]},"zzz":{"correct":0}}'::jsonb as key;
grant all on sample to authenticated;

-- ---------------------------------------------------------------- student
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.save_assignment('e0000000-0000-0000-0000-000000000001', 'X', null,
       (select content from sample), (select key from sample)) $$,
  '42501', null, 'student cannot save assignments');
reset role;

-- ---------------------------------------------------------------- Jean (school B)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.save_assignment('e0000000-0000-0000-0000-000000000001', 'X', null,
       (select content from sample), (select key from sample)) $$,
  '42501', null, 'teacher cannot create an assignment in another school');
select throws_ok(
  $$ select public.save_assignment('e0000000-0000-0000-0000-000000000002', 'X', null,
       (select content from sample), (select key from sample), '[{"class_id":"c0000000-0000-0000-0000-000000000002"}]') $$,
  '42501', null, 'teacher cannot issue to another school''s class');
reset role;

-- ---------------------------------------------------------------- Fiona (admin, school A)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.save_assignment('e0000000-0000-0000-0000-000000000001', '  ', null, (select content from sample), '{}') $$,
  '22023', 'Le titre est requis', 'title is required');
select throws_ok(
  $$ select public.save_assignment('e0000000-0000-0000-0000-000000000001', 'X', null, '{"sections":[]}', '{}') $$,
  '22023', 'Ajoutez au moins une section', 'needs a section');
select throws_ok(
  $$ select public.save_assignment('e0000000-0000-0000-0000-000000000001', 'X', null, (select content from sample), '{"b":{"accept":[]}}') $$,
  '22023', 'Question « Choisissez » : indiquez la bonne réponse', 'choice question needs a correct option');
select throws_ok(
  $$ select public.save_assignment('e0000000-0000-0000-0000-000000000001', 'X', null, (select content from sample), '{"a":{"correct":3}}') $$,
  '22023', 'Question « Choisissez » : indiquez la bonne réponse', 'correct option must exist');
select throws_ok(
  $$ select public.save_assignment('e0000000-0000-0000-0000-000000000001', 'X', null,
       '{"sections":[{"id":"s1","title":"","questions":[{"id":"a","type":"text","prompt":"p"},{"id":"a","type":"text","prompt":"q"}]}]}',
       '{}') $$,
  '22023', 'Identifiants de question manquants ou en double', 'question ids must be unique');

insert into ids select 'new', public.save_assignment('e0000000-0000-0000-0000-000000000001', '  Nouveau devoir ', '',
  (select content from sample), (select key from sample),
  '[{"class_id":"c0000000-0000-0000-0000-000000000002","due_at":"2026-11-01T12:00:00Z"}]');
select is((select title from public.assignments where id = (select id from ids where name = 'new')), 'Nouveau devoir',
  'teacher creates an assignment (title trimmed)');
select is((select owner_id from public.assignments where id = (select id from ids where name = 'new')),
  'a0000000-0000-0000-0000-000000000001'::uuid, 'creator owns it');
select is((select key from public.answer_keys where assignment_id = (select id from ids where name = 'new')) ? 'zzz', false,
  'key entries for unknown questions are dropped');
select is(
  (select array_agg(class_id::text || ' ' || is_open || ' ' || due_at) from public.class_assignments
   where assignment_id = (select id from ids where name = 'new')),
  array['c0000000-0000-0000-0000-000000000002 true 2026-11-01 12:00:00+00'], 'issued to the class, open, with its due date');
reset role;

-- ---------------------------------------------------------------- Marie cannot edit Fiona's assignment
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  format($$ select public.save_assignment('e0000000-0000-0000-0000-000000000001', 'Volé', null, (select content from sample),
           (select key from sample), p_id => %L) $$,
         (select id from ids where name = 'new')),
  'P0002', 'Devoir introuvable', 'only the owner or an admin can edit');
reset role;

-- ---------------------------------------------------------------- student 3 (FSF3U7-1) submits
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.assignments), 1::bigint, 'student of that class now sees it');
select is(public.submit_assignment((select id from ids where name = 'new'), '{"a":0,"b":"Se sont parlé."}') -> 'score',
  '2'::jsonb, 'graded with the saved key (a wrong, b right)');
reset role;

-- ---------------------------------------------------------------- Fiona fixes the key and changes classes
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.grade_submission((select id from public.submissions where assignment_id = (select id from ids where name = 'new')),
  '{"b":"incorrect"}');
select lives_ok(
  format($$ select public.save_assignment('e0000000-0000-0000-0000-000000000001', 'Nouveau devoir', null, (select content from sample),
       '{"a":{"correct":0},"b":{"accept":["se sont parlé"]}}',
       '[{"class_id":"c0000000-0000-0000-0000-000000000001","is_open":false},{"class_id":"c0000000-0000-0000-0000-000000000003"}]',
       p_id => %L) $$,
       (select id from ids where name = 'new')),
  'owner updates key and classes');
select is((select auto_results from public.submissions where assignment_id = (select id from ids where name = 'new')),
  '{"a":"correct","b":"correct"}'::jsonb, 're-grading redoes auto results with the new key');
select is((select score from public.submissions where assignment_id = (select id from ids where name = 'new')),
  1::numeric, 'teacher override is kept and the score is recomputed');
select is(
  (select array_agg(class_id::text || ' ' || is_open order by class_id) from public.class_assignments
   where assignment_id = (select id from ids where name = 'new')),
  array['c0000000-0000-0000-0000-000000000001 false', 'c0000000-0000-0000-0000-000000000003 true'],
  'class list is replaced, with per-class open state');
reset role;

select * from finish();
rollback;
