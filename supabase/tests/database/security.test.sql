-- RLS and RPC tests. Run with `npm run db:test` (after `npm run db:reset`; relies on seed.sql).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok(
  $$ select public.submit_assignment('d0000000-0000-0000-0000-000000000001', '{}') $$,
  '42501', null, 'anon cannot call submit_assignment');
select is((select count(*) from public.classes), 0::bigint, 'anon sees no classes');
reset role;

-- ---------------------------------------------------------------- student 1 (FSF2D7-2)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.answer_keys), 0::bigint, 'student cannot read answer keys');
select is((select count(*) from public.profiles), 1::bigint, 'student only sees own profile');
select is((select count(*) from public.assignments), 1::bigint, 'student sees assignment for their class');
select throws_ok(
  $$ insert into public.submissions (assignment_id, student_id, answers)
     values ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{}') $$,
  '42501', null, 'student cannot insert submissions directly');
select lives_ok(
  $$ update public.profiles set role = 'teacher' where id = 'b0000000-0000-0000-0000-000000000001' $$,
  'student update of own role is not an error...');
select is((select role::text from public.profiles where id = 'b0000000-0000-0000-0000-000000000001'),
  'student', '...but has no effect');

-- 13 choice questions all correct; q3_1/q3_2 accepted (with normalization), q3_3 needs review, q3_4 empty.
select is(
  public.submit_assignment('d0000000-0000-0000-0000-000000000001', $j$ {
    "q1_1": 0, "q1_2": 1, "q1_3": 0, "q1_4": 0, "q1_5": 0,
    "q2_1": 0, "q2_2": 0, "q2_3": 0, "q2_4": 0, "q2_5": 0,
    "q3_1": "  Se sont   dit. ", "q3_2": "nous sommes aidés", "q3_3": "se sont téléphonés", "q3_4": "",
    "q4_1": 0, "q4_2": 0, "q4_3": 0 } $j$) - 'submitted_at',
  '{"status": "submitted", "score": 15, "max_score": 17, "pending_review": 1}'::jsonb,
  'submit grades choices and accepted text, flags the rest for review');
select throws_ok(
  $$ select public.submit_assignment('d0000000-0000-0000-0000-000000000001', '{}') $$,
  '23505', null, 'cannot submit twice');
select is((select count(*) from public.submissions), 0::bigint, 'student cannot read submissions table');
select is(public.my_submission_detail('d0000000-0000-0000-0000-000000000001') -> 'key', 'null'::jsonb,
  'answer key hidden before return');
select is(public.my_submission_detail('d0000000-0000-0000-0000-000000000001') -> 'marks', 'null'::jsonb,
  'marks hidden before return');
select is((select score from public.my_submissions()), 15::numeric, 'score shown when show_score_on_submit');
select throws_ok(
  $$ select public.grade_submission((select id from public.submissions limit 1), '{}', '{}', null, true) $$,
  '42501', null, 'student cannot grade');
select throws_ok(
  $$ select public.return_submissions('d0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'student cannot return submissions');
reset role;

-- ---------------------------------------------------------------- student 3 (other class)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.assignments), 0::bigint, 'student does not see other classes'' assignments');
select throws_ok(
  $$ select public.submit_assignment('d0000000-0000-0000-0000-000000000001', '{}') $$,
  'P0002', null, 'student cannot submit to another class''s assignment');
select is(public.my_submission_detail('d0000000-0000-0000-0000-000000000001'), null::jsonb,
  'no submission detail for someone else''s work');
reset role;

-- ---------------------------------------------------------------- teacher
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.profiles), 4::bigint, 'teacher sees all profiles');
select is((select count(*) from public.answer_keys), 1::bigint, 'teacher reads answer keys');
select is((select count(*) from public.submissions), 1::bigint, 'teacher reads submissions');
select is(public.return_submissions('d0000000-0000-0000-0000-000000000001'),
  '{"returned": 0, "skipped_pending_review": 1}'::jsonb, 'bulk return skips work needing review');
select throws_ok(
  $$ select public.grade_submission((select id from public.submissions limit 1), '{"q3_3": "maybe"}') $$,
  '22023', null, 'invalid mark rejected');
select is(
  (public.grade_submission((select id from public.submissions limit 1),
     '{"q3_3": "correct"}', '{"q3_4": "Il faut écrire une réponse."}', 'Bon travail !', true)).score,
  16::numeric, 'teacher override is included in the score');
reset role;

-- ---------------------------------------------------------------- student 1 after return
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.my_submission_detail('d0000000-0000-0000-0000-000000000001') ->> 'status', 'returned',
  'student sees returned status');
select is(public.my_submission_detail('d0000000-0000-0000-0000-000000000001') -> 'marks' ->> 'q3_3', 'correct',
  'student sees teacher override after return');
select isnt(public.my_submission_detail('d0000000-0000-0000-0000-000000000001') -> 'key', 'null'::jsonb,
  'answer key revealed after return');
reset role;

-- ---------------------------------------------------------------- password-change trigger
update public.profiles set must_change_password = true where id = 'b0000000-0000-0000-0000-000000000002';
update auth.users set encrypted_password = extensions.crypt('nouveau-mdp-123', extensions.gen_salt('bf'))
where id = 'b0000000-0000-0000-0000-000000000002';
select is((select must_change_password from public.profiles where id = 'b0000000-0000-0000-0000-000000000002'),
  false, 'changing password clears must_change_password');

select is((select count(*) from public.profiles where role = 'teacher'), 1::bigint, 'exactly one teacher in seed');

select * from finish();
rollback;
