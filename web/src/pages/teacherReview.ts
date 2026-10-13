import { confirmButton, el, formatDate, fullName, showMessage } from "../dom";
import { link, navigate, type Params } from "../router";
import { errorMessage, supabase } from "../supabase";
import type { AnswerKey, Assignment, Mark, Profile, Submission } from "../types";
import { answerText, correctText, MARK_LABEL, scoreText, STATUS_LABEL } from "./questions";

export async function renderTeacherReview(main: HTMLElement, params: Params) {
  const { data: sub, error } = await supabase.from("submissions").select("*").eq("id", params.id).single();
  if (error) throw error;
  const submission = sub as unknown as Submission;

  const [{ data: assignment, error: e1 }, { data: keyRow, error: e2 }, { data: student, error: e3 }] = await Promise.all([
    supabase.from("assignments").select("*").eq("id", submission.assignment_id).single(),
    supabase.from("answer_keys").select("key").eq("assignment_id", submission.assignment_id).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", submission.student_id).single(),
  ]);
  if (e1 || e2 || e3) throw e1 ?? e2 ?? e3;
  const a = assignment as unknown as Assignment;
  const key = (keyRow?.key ?? null) as AnswerKey | null;
  const p = student as Profile;

  // Edits are collected here and sent in one grade_submission() call.
  const overrides: Record<string, Mark | null> = {};
  const comments: Record<string, string | null> = {};
  const msg = el("div");
  const scoreEl = el("span", {}, scoreText(submission.score, submission.max_score));
  const overall = el("textarea", { rows: 3, placeholder: "Commentaire général pour l'élève" });
  overall.value = submission.teacher_comment ?? "";

  main.append(
    link("/enseignant", "← Résultats", "back"),
    el("h1", {}, fullName(p)),
    el("div", { class: "card" },
      el("p", {}, el("strong", {}, a.title)),
      el("p", { class: "muted" }, `${p.email} · Remis le ${formatDate(submission.submitted_at)}`),
      el("p", {}, el("span", { class: `badge badge-${submission.status}` }, STATUS_LABEL[submission.status]), " Note : ", scoreEl),
    ),
  );

  let n = 0;
  for (const section of a.content.sections) {
    main.append(el("section", { class: "card" },
      el("h2", {}, section.title),
      section.questions.map((q) => {
        const auto = submission.auto_results[q.id] ?? "review";
        const current = submission.teacher_marks[q.id];
        const select = el("select", {
          onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            overrides[q.id] = v === "auto" ? null : (v as Mark);
          },
        },
          el("option", { value: "auto" }, `Automatique : ${MARK_LABEL[auto]}`),
          el("option", { value: "correct" }, MARK_LABEL.correct),
          el("option", { value: "incorrect" }, MARK_LABEL.incorrect),
        );
        select.value = current ?? "auto";
        const comment = el("input", {
          type: "text",
          placeholder: "Commentaire (optionnel)",
          value: submission.question_comments[q.id] ?? "",
          oninput: (e: Event) => {
            const v = (e.target as HTMLInputElement).value.trim();
            comments[q.id] = v || null;
          },
        });
        const finalMark = current ?? auto;
        return el("div", { class: `question mark-${finalMark}` },
          q.context ? el("p", { class: "context" }, q.context) : null,
          el("p", { class: "prompt" }, `${++n}. ${q.prompt}`),
          el("div", { class: "compare" },
            el("div", {}, el("span", { class: "label" }, "Réponse de l'élève"), el("span", { class: "answer" }, answerText(q, submission.answers))),
            el("div", {}, el("span", { class: "label" }, "Bonne réponse"), el("span", { class: "answer" }, correctText(q, key))),
          ),
          el("div", { class: "grade-row" }, select, comment),
        );
      }),
    ));
  }

  async function save(returnNow: boolean) {
    try {
      const { data, error } = await supabase.rpc("grade_submission", {
        p_submission_id: submission.id,
        p_marks: overrides,
        p_question_comments: comments,
        p_teacher_comment: overall.value.trim() || undefined,
        p_return: returnNow,
      });
      if (error) throw error;
      const updated = data as unknown as Submission;
      scoreEl.textContent = scoreText(updated.score, updated.max_score);
      showMessage(msg, returnNow ? "Enregistré et retourné à l'élève." : "Enregistré (pas encore retourné).", "success");
    } catch (e) {
      showMessage(msg, errorMessage(e));
    }
  }

  main.append(el("div", { class: "card submit-bar" },
    el("label", {}, "Commentaire général", overall),
    msg,
    el("div", { class: "toolbar" },
      el("button", { class: "btn", type: "button", onclick: () => void save(false) }, "Enregistrer"),
      el("button", { class: "btn btn-primary", type: "button", onclick: () => void save(true) }, "Enregistrer et retourner"),
      confirmButton("Permettre une reprise", "Supprimer cette remise pour que l'élève puisse recommencer ?", async () => {
        const { error } = await supabase.from("submissions").delete().eq("id", submission.id);
        if (error) return showMessage(msg, errorMessage(error));
        navigate("/enseignant", true);
      }, "btn btn-danger-outline"),
    ),
  ));
}
