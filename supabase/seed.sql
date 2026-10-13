-- Local development seed. Runs on `supabase db reset`. NEVER run against production:
-- it creates accounts with a known password.
--
-- Accounts (password for all: motdepasse123):
--   fiona.stewart@tdsb.on.ca  teacher
--   100000001@tdsb.ca         student, FSF2D7-2
--   100000002@tdsb.ca         student, FSF2D7-2
--   100000003@tdsb.ca         student, FSF3U7-1

insert into public.classes (id, code, name) values
  ('c0000000-0000-0000-0000-000000000001', 'FSF2D7-2', 'Français 10e année'),
  ('c0000000-0000-0000-0000-000000000002', 'FSF3U7-1', 'Français 11e année'),
  ('c0000000-0000-0000-0000-000000000003', 'FSF3U7-2', 'Français 11e année');

-- Users. The on_auth_user_created trigger creates a bare profile for each; filled in below.
with u (id, email) as (
  values
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'fiona.stewart@tdsb.on.ca'),
    ('b0000000-0000-0000-0000-000000000001'::uuid, '100000001@tdsb.ca'),
    ('b0000000-0000-0000-0000-000000000002'::uuid, '100000002@tdsb.ca'),
    ('b0000000-0000-0000-0000-000000000003'::uuid, '100000003@tdsb.ca')
), ins as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
         extensions.crypt('motdepasse123', extensions.gen_salt('bf')), now(),
         '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
         '', '', '', ''
  from u
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text,
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       'email', now(), now(), now()
from ins;

update public.profiles p
set first_name = v.first_name, last_name = v.last_name, class_id = v.class_id, role = v.role::public.user_role
from (values
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'Fiona', 'Stewart', null::uuid, 'teacher'),
  ('b0000000-0000-0000-0000-000000000001'::uuid, 'Lucas', 'Tremblay', 'c0000000-0000-0000-0000-000000000001'::uuid, 'student'),
  ('b0000000-0000-0000-0000-000000000002'::uuid, 'Léa', 'Gagnon', 'c0000000-0000-0000-0000-000000000001'::uuid, 'student'),
  ('b0000000-0000-0000-0000-000000000003'::uuid, 'Amir', 'Haddad', 'c0000000-0000-0000-0000-000000000002'::uuid, 'student')
) as v (id, first_name, last_name, class_id, role)
where p.id = v.id;

-- The homework from the original prototype (dropoff/). Explanations were rewritten in full because
-- the prototype's are truncated in the PDF.
insert into public.assignments (id, title, description, content) values (
  'd0000000-0000-0000-0000-000000000001',
  'Les verbes réciproques : relations sociales',
  'Durée : 15 à 20 minutes. Rappel : au passé composé, les verbes réciproques prennent toujours l''auxiliaire être. Si le pronom est COD (rencontrer quelqu''un), le participe passé s''accorde avec le sujet : « Elles se sont rencontrées ». Si le pronom est COI (parler à quelqu''un), il n''y a pas d''accord : « Elles se sont parlé ».',
  $json$
  {
    "sections": [
      {
        "id": "s1",
        "title": "Identification et temps",
        "instructions": "Choisissez la forme verbale réciproque exacte selon le temps et le sujet.",
        "questions": [
          { "id": "q1_1", "type": "choice", "prompt": "Dans notre quartier, mes voisins et moi, nous ______ (s'entraider – présent) pour embellir le parc communautaire.",
            "options": ["nous entraidons", "nous sommes entraidés", "se sont entraidés", "vous entraidez"] },
          { "id": "q1_2", "type": "choice", "prompt": "Hier soir, Sophie et Marc ______ (se téléphoner – passé composé) pendant deux heures pour le projet d'école.",
            "options": ["se sont téléphonés", "se sont téléphoné", "s'ont téléphoné", "se téléphonent"] },
          { "id": "q1_3", "type": "choice", "prompt": "Quand les membres de la famille ont un désaccord, ils ______ (se parler – présent) toujours avec calme.",
            "options": ["se parlent", "se sont parlé", "se parlions", "s'en parlent"] },
          { "id": "q1_4", "type": "choice", "prompt": "Mes deux amies d'enfance ______ (se rencontrer – passé composé) au centre communautaire la semaine dernière.",
            "options": ["se sont rencontrées", "se sont rencontré", "se sont rencontrés", "se rencontrent"] },
          { "id": "q1_5", "type": "choice", "prompt": "Après leur malentendu, Lucas et Léa ______ (se réconcilier – passé composé) rapidement grâce à leurs amis.",
            "options": ["se sont réconciliés", "se sont réconcilié", "se réconcilient", "s'ont réconcilié"] }
        ]
      },
      {
        "id": "s2",
        "title": "Accord du participe passé",
        "instructions": "Déterminez si le pronom est COD (accord) ou COI (pas d'accord, verbe construit avec « à »).",
        "questions": [
          { "id": "q2_1", "type": "choice", "prompt": "Ma sœur et ma mère (se parler au passé composé) ce matin : « Elles se sont ______. »",
            "options": ["parlé", "parlées", "parlés"] },
          { "id": "q2_2", "type": "choice", "prompt": "Mes cousines (se voir au passé composé) à la fête de famille : « Elles se sont ______. »",
            "options": ["vues", "vu", "vus"] },
          { "id": "q2_3", "type": "choice", "prompt": "Les bénévoles de l'association (s'écrire au passé composé) des courriels : « Ils se sont ______ des messages. »",
            "options": ["écrit", "écrits", "écrites"] },
          { "id": "q2_4", "type": "choice", "prompt": "Nos deux meilleures amies (se saluer au passé composé) chaleureusement : « Elles se sont ______. »",
            "options": ["saluées", "salué", "salués"] },
          { "id": "q2_5", "type": "choice", "prompt": "Les voisins (se sourire au passé composé) en se croisant dans la rue : « Ils se sont ______. »",
            "options": ["souri", "souris", "sourires"] }
        ]
      },
      {
        "id": "s3",
        "title": "Transformation grammaticale",
        "instructions": "Mettez les verbes réciproques au passé composé. Écrivez la forme complète (ex. se sont téléphoné, nous sommes aidés).",
        "questions": [
          { "id": "q3_1", "type": "text", "context": "Présent : Les membres de la famille se disent bonjour tous les matins.",
            "prompt": "Au passé composé : Les membres de la famille ______ bonjour." },
          { "id": "q3_2", "type": "text", "context": "Présent : Dans le club des jeunes, nous nous aidons pour nos devoirs.",
            "prompt": "Au passé composé : Dans le club, nous ______ pour nos devoirs." },
          { "id": "q3_3", "type": "text", "context": "Présent : Sarah et Julie se téléphonent après les cours.",
            "prompt": "Au passé composé : Sarah et Julie ______ après les cours." },
          { "id": "q3_4", "type": "text", "context": "Présent : Les nouveaux voisins se croisent souvent dans le quartier.",
            "prompt": "Au passé composé : Les nouveaux voisins ______ souvent." }
        ]
      },
      {
        "id": "s4",
        "title": "Analyse et mise en situation",
        "instructions": "Lisez attentivement chaque scénario avant de répondre.",
        "questions": [
          { "id": "q4_1", "type": "choice", "prompt": "Pourquoi la phrase « Elles se sont parlé » ne prend-elle pas d'accord, alors que « Elles se sont recommandées » s'accorde ?",
            "options": [
              "Parce que « parler » exige la préposition « à » (COI), alors que « recommander » s'adresse directement à la personne (COD).",
              "Parce que le verbe « parler » est un verbe irrégulier au passé composé.",
              "Parce que les pronoms féminins ne s'accordent jamais avec la communication.",
              "C'est une exception orthographique sans explication grammaticale."
            ] },
          { "id": "q4_2", "type": "choice", "prompt": "Dans une communauté solidaire, quelle phrase décrit une action réciproque au PRÉSENT ?",
            "options": [
              "Les citoyens se soutiennent mutuellement lors des évènements communautaires.",
              "Le conseiller municipal soutient les citoyens de la ville.",
              "Les bénévoles ont soutenu le centre d'aide.",
              "Chaque habitant soutient son propre projet."
            ] },
          { "id": "q4_3", "type": "choice", "prompt": "Choisissez la combinaison correcte : « Paul et Thomas se sont ______ (disputer), mais ils se sont vite ______ (pardonner). »",
            "options": ["disputés / pardonné", "disputé / pardonné", "disputés / pardonnés", "disputer / pardonner"] }
        ]
      }
    ]
  }
  $json$
);

insert into public.answer_keys (assignment_id, key) values (
  'd0000000-0000-0000-0000-000000000001',
  $json$
  {
    "q1_1": { "correct": 0, "explanation": "Au présent, avec le sujet « mes voisins et moi » (= nous) : « nous nous entraidons ». Le pronom réciproque « nous » se place devant le verbe." },
    "q1_2": { "correct": 1, "explanation": "« Téléphoner à quelqu'un » : le pronom « se » est COI, donc pas d'accord : « se sont téléphoné ». Les verbes pronominaux prennent toujours être (jamais « s'ont »)." },
    "q1_3": { "correct": 0, "explanation": "Au présent, avec « ils » : « ils se parlent »." },
    "q1_4": { "correct": 0, "explanation": "« Rencontrer quelqu'un » : le pronom « se » est COD et placé avant le verbe, donc accord avec « mes deux amies » (féminin pluriel) : « rencontrées »." },
    "q1_5": { "correct": 0, "explanation": "« Réconcilier quelqu'un » : COD, donc accord. « Lucas et Léa » est masculin pluriel (le masculin l'emporte) : « réconciliés »." },
    "q2_1": { "correct": 0, "explanation": "« Parler à quelqu'un » : le pronom « se » est COI, le participe ne s'accorde pas : « parlé »." },
    "q2_2": { "correct": 0, "explanation": "« Voir quelqu'un » : COD, accord avec « elles » (féminin pluriel) : « vues »." },
    "q2_3": { "correct": 0, "explanation": "« Écrire à quelqu'un » : « se » est COI. Le COD « des messages » est placé après le verbe, donc pas d'accord : « écrit »." },
    "q2_4": { "correct": 0, "explanation": "« Saluer quelqu'un » : COD, accord avec « nos deux meilleures amies » (féminin pluriel) : « saluées »." },
    "q2_5": { "correct": 0, "explanation": "« Sourire à quelqu'un » : COI, le participe « souri » reste invariable." },
    "q3_1": { "accept": ["se sont dit"], "explanation": "« Dire bonjour à quelqu'un » : « se » est COI, donc pas d'accord : « se sont dit »." },
    "q3_2": { "accept": ["nous sommes aidés", "nous sommes aidées"], "explanation": "« Aider quelqu'un » : COD, accord avec « nous » (pluriel) : « nous nous sommes aidés » (ou « aidées » pour un groupe féminin)." },
    "q3_3": { "accept": ["se sont téléphoné"], "explanation": "« Téléphoner à quelqu'un » : COI, le participe reste invariable : « se sont téléphoné »." },
    "q3_4": { "accept": ["se sont croisés"], "explanation": "« Croiser quelqu'un » : COD, accord avec « les nouveaux voisins » (masculin pluriel) : « se sont croisés »." },
    "q4_1": { "correct": 0, "explanation": "« Parler à quelqu'un » : COI, pas d'accord. « Recommander quelqu'un » : COD, accord avec le sujet." },
    "q4_2": { "correct": 0, "explanation": "« Se soutenir mutuellement » : chacun soutient l'autre, et le verbe est au présent. Les autres phrases ne sont pas réciproques ou ne sont pas au présent." },
    "q4_3": { "correct": 0, "explanation": "« Disputer quelqu'un » : COD → « disputés ». « Pardonner à quelqu'un » : COI → « pardonné » (invariable)." }
  }
  $json$
);

insert into public.assignment_classes (assignment_id, class_id) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001');
