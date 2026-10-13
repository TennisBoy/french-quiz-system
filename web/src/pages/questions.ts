import type { AnswerKey, Answers, Assignment, Mark, Question } from "../types";

export function allQuestions(assignment: Assignment): Question[] {
  return assignment.content.sections.flatMap((s) => s.questions);
}

/** Human-readable student answer (choice answers are stored as option indexes). */
export function answerText(q: Question, answers: Answers): string {
  const a = answers[q.id];
  if (a === undefined || a === null || a === "") return "(sans réponse)";
  if (q.type === "choice") return q.options?.[Number(a)] ?? `(option ${a})`;
  return String(a);
}

export function correctText(q: Question, key: AnswerKey | null): string {
  const k = key?.[q.id];
  if (!k) return "";
  if (q.type === "choice") return k.correct !== undefined ? q.options?.[k.correct] ?? "" : "";
  return (k.accept ?? []).join(" / ");
}

export const MARK_LABEL: Record<Mark, string> = {
  correct: "✔ Correct",
  incorrect: "✘ Incorrect",
  review: "À corriger",
};

export const STATUS_LABEL = {
  submitted: "Remis",
  graded: "Corrigé (non retourné)",
  returned: "Retourné",
} as const;

export function scoreText(score: number | null | undefined, max: number | null | undefined): string {
  if (score === null || score === undefined || !max) return "";
  return `${score} / ${max} (${Math.round((score / max) * 100)} %)`;
}
