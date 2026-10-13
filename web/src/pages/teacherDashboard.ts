import { confirmButton, downloadCsv, el, formatDate, fullName, showMessage } from "../dom";
import { link } from "../router";
import { errorMessage, supabase } from "../supabase";
import type { Mark, Profile, Submission } from "../types";
import { classLabel } from "./classes";
import { scoreText, STATUS_LABEL } from "./questions";

type SubmissionSummary = Pick<
  Submission,
  "id" | "student_id" | "status" | "score" | "max_score" | "submitted_at" | "returned_at" | "auto_results" | "teacher_marks"
>;

function pendingReview(s: SubmissionSummary): number {
  const marks: Record<string, Mark> = { ...s.auto_results, ...s.teacher_marks };
  return Object.values(marks).filter((m) => m === "review").length;
}

// Remember the last class/assignment picked (per browser only).
function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function renderTeacherDashboard(main: HTMLElement) {
  const { data: classes, error } = await supabase.rpc("my_classes");
  if (error) throw error;

  main.append(el("h1", {}, "Résultats des élèves"));
  if (!classes.length) {
    main.append(el("p", {}, "Aucune classe. ", link("/enseignant/eleves", "Créez une classe et ajoutez des élèves.")));
    return;
  }

  const classSelect = el("select", {}, classes.map((c) => el("option", { value: c.id }, classLabel(c, classes))));
  const assignmentSelect = el("select");
  const body = el("div");
  const savedClass = remember("dash:class");
  classSelect.value = savedClass && classes.some((c) => c.id === savedClass) ? savedClass : classes[0].id;

  async function loadAssignments() {
    remember("dash:class", classSelect.value);
    const { data, error } = await supabase
      .from("class_assignments")
      .select("assignments(id, title)")
      .eq("class_id", classSelect.value);
    if (error) return showMessage(body, errorMessage(error));
    const list = data.flatMap((r) => (r.assignments ? [r.assignments] : []));
    assignmentSelect.replaceChildren(...list.map((a) => el("option", { value: a.id }, a.title)));
    const saved = remember("dash:assignment");
    if (saved && list.some((a) => a.id === saved)) assignmentSelect.value = saved;
    if (!list.length) {
      body.replaceChildren(el("p", { class: "muted" }, "Aucun devoir assigné à cette classe. ", link("/enseignant/devoirs", "Gérer les devoirs")));
      return;
    }
    await loadTable();
  }

  async function loadTable() {
    remember("dash:assignment", assignmentSelect.value);
    const classId = classSelect.value;
    const assignmentId = assignmentSelect.value;
    const [{ data: enrolled, error: e1 }, { data: subs, error: e2 }] = await Promise.all([
      supabase.from("enrollments").select("profiles(*)").eq("class_id", classId),
      supabase
        .from("submissions")
        .select("id, student_id, status, score, max_score, submitted_at, returned_at, auto_results, teacher_marks")
        .eq("assignment_id", assignmentId)
        .eq("class_id", classId),
    ]);
    if (e1 || e2) return showMessage(body, errorMessage(e1 ?? e2));

    const students = enrolled.flatMap((e) => (e.profiles ? [e.profiles as Profile] : []))
      .sort((a, b) => a.last_name.localeCompare(b.last_name, "fr"));
    const byStudent = new Map((subs as unknown as SubmissionSummary[]).map((s) => [s.student_id, s]));
    const rows = students.map((p) => ({ p, s: byStudent.get(p.id) }));
    const submitted = rows.filter((r) => r.s);
    const avg = submitted.length
      ? submitted.reduce((t, r) => t + (r.s!.max_score ? r.s!.score / r.s!.max_score : 0), 0) / submitted.length
      : null;
    const msg = el("div");

    body.replaceChildren(
      el("div", { class: "stats" },
        el("div", { class: "stat" }, el("span", { class: "stat-value" }, `${submitted.length} / ${rows.length}`), el("span", {}, "remis")),
        el("div", { class: "stat" }, el("span", { class: "stat-value" }, avg === null ? "—" : `${Math.round(avg * 100)} %`), el("span", {}, "moyenne")),
        el("div", { class: "stat" }, el("span", { class: "stat-value" }, String(submitted.filter((r) => pendingReview(r.s!) > 0).length)), el("span", {}, "à corriger")),
      ),
      msg,
      el("div", { class: "toolbar" },
        el("button", { class: "btn", type: "button", onclick: () => void loadTable() }, "Actualiser"),
        confirmButton("Retourner tout", "Retourner toutes les remises corrigées de cette classe ?", async () => {
          const { data, error } = await supabase.rpc("return_submissions", { p_assignment_id: assignmentId, p_class_id: classId });
          if (error) return showMessage(msg, errorMessage(error));
          const r = data as unknown as { returned: number; skipped_pending_review: number };
          await loadTable();
          showMessage(msg, `${r.returned} remise(s) retournée(s). ${r.skipped_pending_review} ignorée(s) : questions encore à corriger.`, "success");
        }),
        el("button", {
          class: "btn",
          type: "button",
          onclick: () => downloadCsv(`resultats-${classes!.find((c) => c.id === classId)?.code ?? "classe"}.csv`, [
            ["Nom", "Prénom", "Courriel", "Statut", "Note", "Sur", "Remis le", "Retourné le"],
            ...rows.map(({ p, s }) => [
              p.last_name, p.first_name, p.email,
              s ? STATUS_LABEL[s.status] : "Non remis",
              s?.score ?? "", s?.max_score ?? "", s ? formatDate(s.submitted_at) : "", s ? formatDate(s.returned_at) : "",
            ]),
          ]),
        }, "Exporter CSV"),
      ),
      el("table", { class: "table" },
        el("thead", {}, el("tr", {}, ["Élève", "Courriel", "Statut", "Note", "Remis le", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows.map(({ p, s }) => el("tr", {},
          el("td", {}, fullName(p)),
          el("td", { class: "muted" }, p.email),
          el("td", {},
            el("span", { class: `badge badge-${s?.status ?? "missing"}` }, s ? STATUS_LABEL[s.status] : "Non remis"),
            s && pendingReview(s) > 0 ? el("span", { class: "badge badge-review" }, `${pendingReview(s)} à corriger`) : null,
          ),
          el("td", {}, s ? scoreText(s.score, s.max_score) : ""),
          el("td", { class: "muted" }, s ? formatDate(s.submitted_at) : ""),
          el("td", {}, s ? link(`/enseignant/remise/${s.id}`, "Ouvrir", "btn btn-small") : null),
        ))),
      ),
    );
  }

  classSelect.addEventListener("change", () => void loadAssignments());
  assignmentSelect.addEventListener("change", () => void loadTable());
  main.append(
    el("div", { class: "card filters" }, el("label", {}, "Classe", classSelect), el("label", {}, "Devoir", assignmentSelect)),
    body,
  );
  await loadAssignments();
}
