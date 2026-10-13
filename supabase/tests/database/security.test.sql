-- Who can see and do what, per role and across schools. Run with `npm run db:test`
-- (after `npm run db:reset`; relies on seed.sql — see the account list at the top of it).
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$ select count(*) from public.classes $$, '42501', null, 'anon cannot read tables');
select throws_ok(
  $$ select public.submit_assignment('d0000000-0000-0000-0000-000000000001', '{}') $$,
  '42501', null, 'anon cannot call RPCs');
reset role;

-- ---------------------------------------------------------------- student 1 (school A, FSF2D7-2)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.profiles), 1::bigint, 'student sees only own profile');
select is((select count(*) from public.schools), 1::bigint, 'student sees own school');
select is((select count(*) from public.school_members), 1::bigint, 'student sees only own membership');
select is((select array_agg(code) from public.classes), '{FSF2D7-2}'::text[], 'student sees only own class');
select is((select count(*) from public.enrollments), 1::bigint, 'student sees only own enrollment');
select is((select count(*) from public.assignments), 1::bigint, 'student sees the assignment issued to their class');
select is((select count(*) from public.answer_keys), 0::bigint, 'student cannot read answer keys');
select is((select count(*) from public.class_teachers), 0::bigint, 'student cannot read class_teachers');
select is(public.my_context() -> 'memberships' -> 0 ->> 'role', 'student', 'my_context reports the student role');
select is((select count(*) from public.my_classes()), 0::bigint, 'student teaches no classes');
select throws_ok(
  $$ insert into public.submissions (assignment_id, student_id, class_id, answers)
     values ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
             'c0000000-0000-0000-0000-000000000001', '{}') $$,
  '42501', null, 'student cannot insert submissions directly');
select throws_ok(
  $$ insert into public.enrollments (class_id, student_id)
     values ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'student cannot enroll themselves');

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
select is((select count(*) from public.submissions), 0::bigint, 'student cannot read the submissions table');
select is(public.my_submission_detail('d0000000-0000-0000-0000-000000000001') -> 'key', 'null'::jsonb,
  'answer key hidden before return');
select is((select score from public.my_assignments()), 15::numeric, 'my_assignments shows the score when show_score_on_submit');
select throws_ok(
  $$ select public.grade_submission((select id from public.submissions limit 1)) $$,
  'P0002', null, 'student cannot grade');
select throws_ok(
  $$ select public.return_submissions('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'student cannot return submissions');
select throws_ok(
  $$ select public.create_class('e0000000-0000-0000-0000-000000000001', 'X') $$,
  '42501', null, 'student cannot create classes');
reset role;

-- ---------------------------------------------------------------- student 3 (school A, other class)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.assignments), 0::bigint, 'student does not see assignments of other classes');
select throws_ok(
  $$ select public.submit_assignment('d0000000-0000-0000-0000-000000000001', '{}') $$,
  'P0002', null, 'student cannot submit an assignment not issued to their class');
reset role;

-- ---------------------------------------------------------------- student 4 (school B)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select array_agg(name) from public.schools), '{"Autre école"}'::text[], 'student of school B sees only school B');
select is((select count(*) from public.assignments), 0::bigint, 'school B student sees no school A assignment');
reset role;

-- ---------------------------------------------------------------- Marie (teacher, school A, FSF3U7-2 only)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select array_agg(code) from public.my_classes()), '{FSF3U7-2}'::text[], 'teacher teaches only their class');
select is((select count(*) from public.submissions), 0::bigint, 'teacher cannot read submissions of classes they do not teach');
select throws_ok(
  $$ select public.grade_submission((select id from public.submissions limit 1)) $$,
  'P0002', null, 'teacher cannot grade outside their classes');
select is((select count(*) from public.assignments), 1::bigint, 'teacher sees the school''s assignments (shared library)');
select is((select count(*) from public.answer_keys), 1::bigint, 'teacher can read the school''s answer keys');
select is((select count(*) from public.profiles), 5::bigint, 'teacher sees the people of their school only');
with d as (delete from public.assignments where id = 'd0000000-0000-0000-0000-000000000001' returning 1)
select is((select count(*) from d), 0::bigint, 'teacher cannot delete a colleague''s assignment');
with u as (update public.class_assignments set is_open = false where class_id = 'c0000000-0000-0000-0000-000000000001' returning 1)
select is((select count(*) from u), 0::bigint, 'teacher cannot close an assignment in a colleague''s class');
select throws_ok(
  $$ insert into public.enrollments (class_id, student_id)
     values ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'teacher cannot enroll a student from another school');
select lives_ok(
  $$ insert into public.enrollments (class_id, student_id)
     values ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003') $$,
  'teacher can enroll a student of their school in their class');
reset role;

-- ---------------------------------------------------------------- Jean (teacher, school B)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.profiles), 2::bigint, 'school B teacher sees only school B people');
select is((select count(*) from public.assignments), 0::bigint, 'school B teacher sees no school A assignment');
select is((select count(*) from public.answer_keys), 0::bigint, 'school B teacher reads no school A answer key');
select throws_ok(
  $$ select public.create_class('e0000000-0000-0000-0000-000000000001', 'INTRUS') $$,
  '42501', null, 'teacher cannot create a class in another school');
select isnt(public.create_class('e0000000-0000-0000-0000-000000000002', 'FSF1D1-2'), null,
  'teacher creates a class in their school');
select is((select count(*) from public.my_classes()), 2::bigint, '...and teaches it');
reset role;

-- ---------------------------------------------------------------- Fiona (admin, school A)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.my_classes()), 3::bigint, 'admin manages every class of the school');
select is((select count(*) from public.submissions), 1::bigint, 'admin reads the submission');
select is(
  (public.grade_submission((select id from public.submissions limit 1), '{"q3_3": "correct"}', '{"q3_3": "Bien"}', 'Bon travail', false)).score,
  16::numeric, 'teacher override changes the score');
select is(
  public.return_submissions('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
  '{"returned": 1, "skipped_pending_review": 0}'::jsonb, 'bulk return returns graded work');
reset role;

-- ---------------------------------------------------------------- student 1 after return
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.my_submission_detail('d0000000-0000-0000-0000-000000000001') ->> 'teacher_comment', 'Bon travail',
  'student sees the comment after return');
select isnt(public.my_submission_detail('d0000000-0000-0000-0000-000000000001') -> 'key', 'null'::jsonb,
  'student sees the answer key after return');
reset role;

select * from finish();
rollback;
