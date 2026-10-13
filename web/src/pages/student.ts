import { confirmButton, el, formatDate, showMessage } from "../dom";
import { link, navigate, type Params } from "../router";
import { errorMessage, supabase } from "../supabase";
import type { Answers, Assignment, MySubmissionDetail, Profile, Question, SubmissionStatus } from "../types";
import { allQuestions, answerText, correctText, MARK_LABEL, scoreText, STATUS_LABEL } from "./questions";

interface MySubmissionRow {
  assignment_id: string;
  status: SubmissionStatus;
  submitted_at: string;
  returned_at: string | null;
  score: number | null;
  max_score: number | null;
}

export async function renderStudentHome(main: HTMLElement, _params: Params, _profile: Profile | null) {
  const [{ data: assignments, error }, { data: mine, error: mineError }] = await Promise.all([
    supabase.from("assignments").select("id, title, is_open, due_at").order("created_at", { ascending: false }),
    supabase.rpc("my_submissions"),
  ]);
  if (error) throw error;
  if (mineError) throw mineError;
  const byAssignment = new Map((mine as MySubmissionRow[]).map((s) => [s.assignment_id, s]));

  main.append(el("h1", {}, "Mes devoirs"));
  if (!assignments.length) {
    main.append(el("p", { class: "muted" }, "Aucun devoir pour le moment."));
    return;
  }
  main.append(el("ul", { class: "list" }, assignments.map((a) => {
    const sub = byAssignment.get(a.id);
    const status = sub ? STATUS_LABEL[sub.status === "graded" ? "submitted" : sub.status] : a.is_open ? "À faire" : "Fermé";
    return el("li", { class: "list-item" },
      link(`/eleve/devoir/${a.id}`, a.title),
      el("span", { class: `badge badge-${sub?.status ?? (a.is_open ? "todo" : "closed")}` }, status),
      sub?.score !== null && sub?.score !== undefined ? el("span", { class: "muted" }, scoreText(sub.score, sub.max_score)) : null,
      a.due_at ? el("span", { class: "muted small" }, `À remettre : ${formatDate(a.due_at)}`) : null,
    );
  })));
}

export async function renderStudentAssignment(main: HTMLElement, params: Params) {
  const [{ data: assignment, error }, { data: detail, error: detailError }] = await Promise.all([
    supabase.from("assignments").select("*").eq("id", params.id).single(),
    supabase.rpc("my_submission_detail", { p_assignment_id: params.id }),
  ]);
  if (error) throw error;
  if (detailError) throw detailError;

  main.append(link("/eleve", "← Mes devoirs", "back"), el("h1", {}, assignment.title));
  if (assignment.description) main.append(el("p", { class: "card info" }, assignment.description));

  if (detail) renderResult(main, assignment as Assignment, detail as MySubmissionDetail);
  else if (!assignment.is_open) main.append(el("p", { class: "alert alert-info" }, "Ce devoir est fermé."));
  else renderForm(main, assignment as Assignment);
}

// ---------------------------------------------------------------------------------------------
// Taking the assignment

function draftKey(assignmentId: string) {
  return `draft:${assignmentId}`;
}

function loadDraft(assignmentId: string): Answers {
  try {
    return JSON.parse(localStorage.getItem(draftKey(assignmentId)) ?? "{}") as Answers;
  } catch {
    return {};
  }
}

function saveDraft(assignmentId: string, answers: Answers) {
  try {
    localStorage.setItem(draftKey(assignmentId), JSON.stringify(answers));
  } catch {
    // storage unavailable (private mode); drafts are only a convenience
  }
}

function clearDraft(assignmentId: string) {
  try {
    localStorage.removeItem(draftKey(assignmentId));
  } catch {
    // ignore
  }
}

/** Shuffles option display order so the right answer is not always in the same spot. */
function shuffledIndexes(n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function questionInput(q: Question, answers: Answers, onChange: () => void): HTMLElement {
  if (q.type === "choice") {
    return el("div", { class: "options" }, shuffledIndexes(q.options?.length ?? 0).map((i) =>
      el("label", { class: "option" },
        el("input", {
          type: "radio",
          name: q.id,
          value: i,
          checked: answers[q.id] === i,
          onchange: () => {
            answers[q.id] = i;
            onChange();
          },
        }),
        el("span", {}, q.options![i]),
      ),
    ));
  }
  return el("input", {
    type: "text",
    class: "text-answer",
    autocomplete: "off",
    spellcheck: false,
    value: typeof answers[q.id] === "string" ? (answers[q.id] as string) : "",
    oninput: (e: Event) => {
      answers[q.id] = (e.target as HTMLInputElement).value;
      onChange();
    },
  });
}

function renderForm(main: HTMLElement, assignment: Assignment) {
  const answers = loadDraft(assignment.id);
  const msg = el("div");
  const progress = el("span", { class: "muted" });
  const questions = allQuestions(assignment);
  const answeredCount = () => questions.filter((q) => answers[q.id] !== undefined && String(answers[q.id]).trim() !== "").length;
  const onChange = () => {
    saveDraft(assignment.id, answers);
    progress.textContent = `${answeredCount()} / ${questions.length} réponses`;
  };

  let n = 0;
  for (const [si, section] of assignment.content.sections.entries()) {
    main.append(el("section", { class: "card" },
      el("p", { class: "eyebrow" }, `Partie ${si + 1} / ${assignment.content.sections.length}`),
      el("h2", {}, section.title),
      section.instructions ? el("p", { class: "muted" }, section.instructions) : null,
      section.questions.map((q) => el("div", { class: "question" },
        q.context ? el("p", { class: "context" }, q.context) : null,
        el("p", { class: "prompt" }, `${++n}. ${q.prompt}`),
        questionInput(q, answers, onChange),
      )),
    ));
  }

  const submit = async () => {
    try {
      const { error } = await supabase.rpc("submit_assignment", { p_assignment_id: assignment.id, p_answers: answers });
      if (error) throw error;
      clearDraft(assignment.id);
      navigate(`/eleve/devoir/${assignment.id}`, true);
    } catch (e) {
      showMessage(msg, errorMessage(e));
    }
  };

  onChange();
  main.append(el("div", { class: "card submit-bar" },
    msg,
    progress,
    confirmButton("Remettre mes réponses", "Vous ne pourrez plus modifier vos réponses. Remettre ?", submit, "btn btn-primary"),
  ));
}

// ---------------------------------------------------------------------------------------------
// After submitting

function renderResult(main: HTMLElement, assignment: Assignment, d: MySubmissionDetail) {
  const returned = d.status === "returned";
  main.append(el("div", { class: "card" },
    el("p", {}, el("span", { class: `badge badge-${d.status}` }, returned ? "Retourné" : "Remis, en attente de correction")),
    el("p", { class: "muted" }, `Remis le ${formatDate(d.submitted_at)}`),
    d.score !== null ? el("p", { class: "score" }, returned ? "Note : " : "Note automatique (provisoire) : ", scoreText(d.score, d.max_score)) : null,
    returned && d.teacher_comment ? el("blockquote", { class: "comment" }, d.teacher_comment) : null,
  ));

  let n = 0;
  for (const section of assignment.content.sections) {
    main.append(el("section", { class: "card" },
      el("h2", {}, section.title),
      section.questions.map((q) => {
        const mark = d.marks?.[q.id];
        const explanation = d.key?.[q.id]?.explanation;
        const comment = d.question_comments?.[q.id];
        return el("div", { class: `question ${mark ? `mark-${mark}` : ""}` },
          q.context ? el("p", { class: "context" }, q.context) : null,
          el("p", { class: "prompt" }, `${++n}. ${q.prompt}`),
          el("p", {}, el("strong", {}, "Votre réponse : "), answerText(q, d.answers)),
          mark ? el("p", { class: `mark mark-${mark}` }, MARK_LABEL[mark]) : null,
          returned && mark !== "correct" && d.key ? el("p", {}, el("strong", {}, "Bonne réponse : "), correctText(q, d.key)) : null,
          explanation ? el("p", { class: "explanation" }, explanation) : null,
          comment ? el("p", { class: "comment" }, `Commentaire : ${comment}`) : null,
        );
      }),
    ));
  }
  if (returned) main.append(el("button", { class: "btn no-print", type: "button", onclick: () => window.print() }, "Imprimer / PDF"));
}
