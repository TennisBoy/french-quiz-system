-- Assignment authoring: the teacher saves an assignment, its answer key and its classes in one
-- transaction through save_assignment(). Auto-grading moves into private.grade_answers() so that
-- submit_assignment() and re-grading after a key change use the same rules.

-- { "<question id>": "correct" | "incorrect" | "review" } for one set of answers.
-- Empty answers are incorrect; questions without a key entry go to review; text answers that match
-- an accepted answer (after normalize_answer) are correct, anything else goes to review.
create function private.grade_answers(p_content jsonb, p_key jsonb, p_answers jsonb)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_results jsonb := '{}';
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

create or replace function public.submit_assignment(p_assignment_id uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_profile    public.profiles;
  v_assignment public.assignments;
  v_results    jsonb;
  v_sub        public.submissions;
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

  v_results := private.grade_answers(
    v_assignment.content,
    (select key from public.answer_keys where assignment_id = p_assignment_id),
    p_answers);

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

-- Creates (p_id null) or updates an assignment with its answer key and classes. Validates the content
-- shape the student page and grading rely on. Existing submissions always get their score recomputed
-- (the trigger runs on update); with p_regrade their auto_results are also redone with the new key.
-- Teacher marks are overrides and are kept either way. Returns the assignment id.
create function public.save_assignment(
  p_id uuid,
  p_title text,
  p_description text,
  p_content jsonb,
  p_key jsonb,
  p_class_ids uuid[],
  p_is_open boolean default true,
  p_due_at timestamptz default null,
  p_show_score_on_submit boolean default true,
  p_regrade boolean default true
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id   uuid := p_id;
  v_ids  text[];
  v_key  jsonb;
  v_opts jsonb;
  v_k    jsonb;
  q      jsonb;
begin
  if not private.is_teacher() then
    raise exception 'Réservé à l''enseignant' using errcode = '42501';
  end if;

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

  -- Keep only key entries for questions that still exist.
  select coalesce(jsonb_object_agg(k, v), '{}') into v_key
  from jsonb_each(coalesce(p_key, '{}')) e(k, v)
  where k = any (v_ids);

  if v_id is null then
    insert into public.assignments (title, description, content, is_open, due_at, show_score_on_submit)
    values (btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_content,
            coalesce(p_is_open, true), p_due_at, coalesce(p_show_score_on_submit, true))
    returning id into v_id;
  else
    update public.assignments
    set title = btrim(p_title),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        content = p_content,
        is_open = coalesce(p_is_open, true),
        due_at = p_due_at,
        show_score_on_submit = coalesce(p_show_score_on_submit, true)
    where id = v_id;
    if not found then
      raise exception 'Devoir introuvable' using errcode = 'P0002';
    end if;
  end if;

  insert into public.answer_keys (assignment_id, key) values (v_id, v_key)
  on conflict (assignment_id) do update set key = excluded.key;

  delete from public.assignment_classes
  where assignment_id = v_id and not (class_id = any (coalesce(p_class_ids, '{}')));
  insert into public.assignment_classes (assignment_id, class_id)
  select v_id, c from unnest(coalesce(p_class_ids, '{}')) c
  on conflict do nothing;

  update public.submissions s
  set auto_results = case when p_regrade then private.grade_answers(p_content, v_key, s.answers) else s.auto_results end
  where s.assignment_id = v_id;

  return v_id;
end;
$$;

revoke execute on function private.grade_answers(jsonb, jsonb, jsonb) from public;

revoke execute on function
  public.save_assignment(uuid, text, text, jsonb, jsonb, uuid[], boolean, timestamptz, boolean, boolean)
from public, anon;
grant execute on function
  public.save_assignment(uuid, text, text, jsonb, jsonb, uuid[], boolean, timestamptz, boolean, boolean)
to authenticated;
