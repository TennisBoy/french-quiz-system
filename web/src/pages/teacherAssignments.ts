import { confirmButton, displayName, el, formatDate, showMessage } from "../dom";
import { link, navigate, type Params } from "../router";
import { adminSchools, errorMessage, staffSchools, supabase } from "../supabase";
import type { Json } from "../database.types";
import type { AnswerKey, Assignment, KeyEntry, Me, Question, Section, TaughtClass } from "../types";
import { sectionCards } from "./student";

// ---------------------------------------------------------------------------------------------
// List

/** The owner and school admins may edit or delete an assignment; other teachers may duplicate it. */
function canEdit(me: Me, a: { owner_id: string | null; school_id: string }): boolean {
  return a.owner_id === me.profile.id || adminSchools(me).some((s) => s.school_id === a.school_id);
}

export async function renderTeacherAssignments(main: HTMLElement, _params: Params, me: Me | null) {
  if (!me) return;
  const [{ data: classes, error: e1 }, { data: assignments, error: e2 }] = await Promise.all([
    supabase.rpc("my_classes"),
    // class_assignments and submissions are limited by RLS to the caller's classes.
    supabase
      .from("assignments")
      .select("id, title, school_id, owner_id, owner:profiles!assignments_owner_id_fkey(first_name, last_name, honorific), class_assignments(class_id, is_open, due_at), submissions(count)")
      .order("created_at", { ascending: false }),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const codes = new Map(classes.map((c) => [c.id, c.code]));
  const msg = el("div");

  main.append(
    el("h1", {}, "Devoirs"),
    el("p", { class: "muted" }, "Les devoirs de votre école. Vous modifiez les vôtres ; dupliquez ceux d'un·e collègue pour les adapter."),
    el("div", { class: "toolbar" }, link("/enseignant/devoirs/nouveau", "+ Nouveau devoir", "btn btn-primary")),
    msg,
  );
  if (!assignments.length) {
    main.append(el("p", { class: "muted" }, "Aucun devoir. Créez-en un pour commencer."));
    return;
  }

  main.append(el("table", { class: "table" },
    el("thead", {}, el("tr", {}, ["Devoir", "Auteur", "Mes classes", "État", "À remettre", "Remises", ""].map((h) => el("th", {}, h)))),
    el("tbody", {}, assignments.map((a) => {
      const count = a.submissions[0]?.count ?? 0;
      const issues = a.class_assignments.filter((ca) => codes.has(ca.class_id));
      const open = issues.some((ca) => ca.is_open);
      const due = issues.map((ca) => ca.due_at).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
      const editable = canEdit(me, a);
      return el("tr", {},
        el("td", {}, link(`/enseignant/devoirs/${a.id}`, a.title)),
        el("td", { class: "muted" }, a.owner ? displayName(a.owner) : "—"),
        el("td", { class: "nowrap" }, issues.length
          ? issues.map((ca) => codes.get(ca.class_id)).sort().join(", ")
          : el("span", { class: "badge badge-review" }, "Aucune classe")),
        el("td", {}, issues.length ? el("span", { class: `badge ${open ? "badge-returned" : "badge-closed"}` }, open ? "Ouvert" : "Fermé") : ""),
        el("td", { class: "muted" }, formatDate(due)),
        el("td", {}, String(count)),
        el("td", { class: "actions" },
          link(`/enseignant/devoirs/${a.id}`, editable ? "Modifier" : "Voir", "btn btn-small"),
          issues.length
            ? el("button", {
              class: "btn btn-small",
              type: "button",
              onclick: async () => {
                const { error } = await supabase.from("class_assignments").update({ is_open: !open }).eq("assignment_id", a.id);
                if (error) return showMessage(msg, errorMessage(error));
                navigate("/enseignant/devoirs", true);
              },
            }, open ? "Fermer" : "Ouvrir")
            : null,
          el("button", {
            class: "btn btn-small",
            type: "button",
            onclick: async () => {
              try {
                navigate(`/enseignant/devoirs/${await duplicate(a.id)}`);
              } catch (e) {
                showMessage(msg, errorMessage(e));
              }
            },
          }, "Dupliquer"),
          editable
            ? confirmButton(
              "Supprimer",
              count ? `Supprimer ce devoir et les ${count} remise(s) des élèves ?` : "Supprimer ce devoir ?",
              async () => {
                const { error } = await supabase.from("assignments").delete().eq("id", a.id);
                if (error) return showMessage(msg, errorMessage(error));
                navigate("/enseignant/devoirs", true);
              },
              "btn btn-small btn-danger-outline",
            )
            : null,
        ),
      );
    })),
  ));
}

/** Copies an assignment (questions + key) as the caller's own, with no classes, so it can be adapted. */
async function duplicate(id: string): Promise<string> {
  const [{ data: a, error: e1 }, { data: k, error: e2 }] = await Promise.all([
    supabase.from("assignments").select("*").eq("id", id).single(),
    supabase.from("answer_keys").select("key").eq("assignment_id", id).maybeSingle(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const { data, error } = await supabase.rpc("save_assignment", {
    p_school_id: a.school_id,
    p_title: `Copie de ${a.title}`,
    p_description: a.description ?? "",
    p_content: a.content,
    p_key: k?.key ?? {},
    p_classes: [],
    p_show_score_on_submit: a.show_score_on_submit,
  });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------------------------
// Editor

interface DraftQuestion {
  id: string;
  type: "choice" | "text";
  prompt: string;
  context: string;
  options: string[];
  points: number;
  correct: number | null;
  accept: string; // one accepted answer per line
  explanation: string;
}

interface DraftSection {
  id: string;
  title: string;
  instructions: string;
  questions: DraftQuestion[];
}

/** The assignment as issued to one of the caller's classes. */
interface DraftIssue {
  is_open: boolean;
  due_at: string; // <input type="datetime-local"> value, local time
}

interface Draft {
  id: string | null;
  school_id: string;
  title: string;
  description: string;
  show_score_on_submit: boolean;
  issues: Map<string, DraftIssue>; // class id → issue, for the caller's classes that get it
  sections: DraftSection[];
}

interface IssueRow {
  class_id: string;
  is_open: boolean;
  due_at: string | null;
}

const newId = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;

function blankQuestion(type: DraftQuestion["type"]): DraftQuestion {
  return {
    id: newId("q_"), type, prompt: "", context: "", options: type === "choice" ? ["", ""] : [],
    points: 1, correct: null, accept: "", explanation: "",
  };
}

function blankSection(): DraftSection {
  return { id: newId("s_"), title: "", instructions: "", questions: [blankQuestion("choice")] };
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toDraft(a: Assignment | null, key: AnswerKey, issues: IssueRow[], schoolId: string): Draft {
  const issueMap = new Map(issues.map((i) => [i.class_id, { is_open: i.is_open, due_at: toLocalInput(i.due_at) }]));
  if (!a) {
    return {
      id: null, school_id: schoolId, title: "", description: "", show_score_on_submit: true,
      issues: issueMap, sections: [blankSection()],
    };
  }
  return {
    id: a.id,
    school_id: a.school_id,
    title: a.title,
    description: a.description ?? "",
    show_score_on_submit: a.show_score_on_submit,
    issues: issueMap,
    sections: a.content.sections.map((s) => ({
      id: s.id,
      title: s.title,
      instructions: s.instructions ?? "",
      questions: s.questions.map((q) => {
        const k: KeyEntry = key[q.id] ?? {};
        return {
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          context: q.context ?? "",
          options: q.options ? [...q.options] : [],
          points: q.points ?? 1,
          correct: k.correct ?? null,
          accept: (k.accept ?? []).join("\n"),
          explanation: k.explanation ?? "",
        };
      }),
    })),
  };
}

/** Draft → the `content` and answer key shapes stored in the database (see CLAUDE.md). */
function toPayload(d: Draft): { content: { sections: Section[] }; key: AnswerKey } {
  const key: AnswerKey = {};
  const sections = d.sections.map((s): Section => ({
    id: s.id,
    title: s.title.trim(),
    ...(s.instructions.trim() ? { instructions: s.instructions.trim() } : {}),
    questions: s.questions.map((q): Question => {
      const entry: KeyEntry = q.type === "choice"
        ? (q.correct === null ? {} : { correct: q.correct })
        : { accept: q.accept.split(/\r?\n/).map((a) => a.trim()).filter(Boolean) };
      if (q.explanation.trim()) entry.explanation = q.explanation.trim();
      key[q.id] = entry;
      return {
        id: q.id,
        type: q.type,
        prompt: q.prompt.trim(),
        ...(q.context.trim() ? { context: q.context.trim() } : {}),
        ...(q.type === "choice" ? { options: q.options.map((o) => o.trim()) } : {}),
        ...(q.points !== 1 ? { points: q.points } : {}),
      };
    }),
  }));
  return { content: { sections }, key };
}

function move<T>(list: T[], i: number, delta: number) {
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

export async function renderTeacherAssignmentEditor(main: HTMLElement, params: Params, me: Me | null) {
  if (!me) return;
  const id = params.id ?? null;
  const schools = staffSchools(me);
  const { data: myClasses, error } = await supabase.rpc("my_classes");
  if (error) throw error;

  let assignment: Assignment | null = null;
  let key: AnswerKey = {};
  let issues: IssueRow[] = [];
  let submissionCount = 0;
  if (id) {
    // class_assignments and submissions are limited by RLS to the caller's classes.
    const [a, k, ac, subs] = await Promise.all([
      supabase.from("assignments").select("*").eq("id", id).single(),
      supabase.from("answer_keys").select("key").eq("assignment_id", id).maybeSingle(),
      supabase.from("class_assignments").select("class_id, is_open, due_at").eq("assignment_id", id),
      supabase.from("submissions").select("id", { count: "exact", head: true }).eq("assignment_id", id),
    ]);
    const failed = a.error ?? k.error ?? ac.error ?? subs.error;
    if (failed) throw failed;
    assignment = a.data as unknown as Assignment;
    key = (k.data?.key ?? {}) as AnswerKey;
    issues = ac.data ?? [];
    submissionCount = subs.count ?? 0;
  }
  if (!assignment && !schools.length) throw new Error("Aucune école où vous enseignez.");

  const draft = toDraft(assignment, key, issues, schools[0]?.school_id ?? "");
  const editable = !assignment || canEdit(me, assignment);
  let dirty = false;
  const changed = () => {
    dirty = true;
  };

  const msg = el("div");
  const issuesBox = el("div");
  const sectionsBox = el("div");
  const previewBox = el("div");
  const saveButton = el("button", { class: "btn btn-primary", type: "submit" }, "Enregistrer");
  const regrade = el("input", { type: "checkbox", checked: true });

  /** Labelled text input or textarea bound to a draft field. */
  function field(label: string, value: string, set: (v: string) => void, opts: { rows?: number; placeholder?: string; required?: boolean } = {}) {
    const input = opts.rows
      ? el("textarea", { rows: opts.rows, placeholder: opts.placeholder, required: opts.required })
      : el("input", { type: "text", placeholder: opts.placeholder, required: opts.required });
    input.value = value;
    input.addEventListener("input", () => {
      set(input.value);
      changed();
    });
    return el("label", {}, label, input);
  }

  function checkbox(label: string, value: boolean, set: (v: boolean) => void) {
    return el("label", { class: "check" },
      el("input", { type: "checkbox", checked: value, onchange: (e: Event) => {
        set((e.target as HTMLInputElement).checked);
        changed();
      } }),
      label,
    );
  }

  /** Structural change (add, remove, move, type): update the model, then redraw the sections. */
  function restructure(fn: () => void) {
    fn();
    changed();
    renderSections();
  }

  function smallButton(label: string, title: string, onclick: () => void, disabled = false) {
    return el("button", { class: "btn btn-small", type: "button", title, "aria-label": title, disabled, onclick }, label);
  }

  function questionEditor(s: DraftSection, q: DraftQuestion, qi: number, number: number): HTMLElement {
    const typeSelect = el("select", {
      "aria-label": "Type de question",
      onchange: () => restructure(() => {
        q.type = typeSelect.value as DraftQuestion["type"];
        if (q.type === "choice" && q.options.length < 2) q.options = ["", ""];
      }),
    }, el("option", { value: "choice" }, "Choix multiple"), el("option", { value: "text" }, "Réponse écrite"));
    typeSelect.value = q.type;

    const points = el("input", { type: "number", min: 0.5, step: 0.5, value: q.points, class: "points" });
    points.addEventListener("input", () => {
      q.points = Number(points.value) > 0 ? Number(points.value) : 1;
      changed();
    });

    const answers = q.type === "choice"
      ? el("fieldset", { class: "choices" },
        el("legend", {}, "Choix : cochez la bonne réponse"),
        q.options.map((opt, oi) => {
          const input = el("input", { type: "text", placeholder: `Choix ${oi + 1}`, "aria-label": `Choix ${oi + 1}` });
          input.value = opt;
          input.addEventListener("input", () => {
            q.options[oi] = input.value;
            changed();
          });
          return el("div", { class: "choice-row" },
            el("input", {
              type: "radio",
              name: `correct-${q.id}`,
              checked: q.correct === oi,
              "aria-label": `Choix ${oi + 1} est la bonne réponse`,
              onchange: () => {
                q.correct = oi;
                changed();
              },
            }),
            input,
            q.options.length > 2
              ? smallButton("✕", "Retirer ce choix", () => restructure(() => {
                q.options.splice(oi, 1);
                if (q.correct === oi) q.correct = null;
                else if (q.correct !== null && q.correct > oi) q.correct--;
              }))
              : null,
          );
        }),
        el("button", { class: "btn btn-small", type: "button", onclick: () => restructure(() => q.options.push("")) }, "+ Ajouter un choix"),
        el("p", { class: "muted small" }, "L'ordre des choix est mélangé pour chaque élève."),
      )
      : el("div", {},
        field("Réponses acceptées (une par ligne)", q.accept, (v) => (q.accept = v), { rows: 2 }),
        el("p", { class: "muted small" },
          "Majuscules, espaces, apostrophes et point final sont ignorés ; les accents comptent. ",
          "Toute autre réponse vous est envoyée « à corriger », jamais comptée fausse automatiquement."),
      );

    return el("div", { class: "q-edit" },
      el("div", { class: "q-head" },
        el("strong", {}, `Question ${number}`),
        typeSelect,
        el("label", { class: "inline" }, "Points", points),
        el("span", { class: "q-tools" },
          smallButton("↑", "Monter la question", () => restructure(() => move(s.questions, qi, -1)), qi === 0),
          smallButton("↓", "Descendre la question", () => restructure(() => move(s.questions, qi, 1)), qi === s.questions.length - 1),
          smallButton("Dupliquer", "Dupliquer la question", () => restructure(() =>
            s.questions.splice(qi + 1, 0, { ...q, id: newId("q_"), options: [...q.options] }))),
          s.questions.length > 1
            ? confirmButton("Supprimer", "Supprimer cette question ?", () => restructure(() => s.questions.splice(qi, 1)), "btn btn-small btn-danger-outline")
            : null,
        ),
      ),
      field("Énoncé", q.prompt, (v) => (q.prompt = v), { rows: 2, required: true, placeholder: "ex. Hier, Sophie et Marc ______ (se téléphoner – passé composé)." }),
      field("Contexte (optionnel, affiché au-dessus de l'énoncé)", q.context, (v) => (q.context = v)),
      answers,
      field("Explication (montrée à l'élève seulement après le retour)", q.explanation, (v) => (q.explanation = v), { rows: 2 }),
    );
  }

  function renderSections() {
    let number = 0;
    sectionsBox.replaceChildren(
      ...draft.sections.map((s, si) => el("section", { class: "card" },
        el("div", { class: "q-head" },
          el("p", { class: "eyebrow" }, `Partie ${si + 1} / ${draft.sections.length}`),
          el("span", { class: "q-tools" },
            smallButton("↑", "Monter la partie", () => restructure(() => move(draft.sections, si, -1)), si === 0),
            smallButton("↓", "Descendre la partie", () => restructure(() => move(draft.sections, si, 1)), si === draft.sections.length - 1),
            draft.sections.length > 1
              ? confirmButton("Supprimer la partie", `Supprimer cette partie et ses ${s.questions.length} question(s) ?`,
                () => restructure(() => draft.sections.splice(si, 1)), "btn btn-small btn-danger-outline")
              : null,
          ),
        ),
        field("Titre de la partie", s.title, (v) => (s.title = v), { placeholder: "ex. Accord du participe passé" }),
        field("Consignes (optionnel)", s.instructions, (v) => (s.instructions = v), { rows: 2 }),
        s.questions.map((q, qi) => questionEditor(s, q, qi, ++number)),
        el("div", { class: "toolbar" },
          el("button", { class: "btn", type: "button", onclick: () => restructure(() => s.questions.push(blankQuestion("choice"))) }, "+ Question à choix"),
          el("button", { class: "btn", type: "button", onclick: () => restructure(() => s.questions.push(blankQuestion("text"))) }, "+ Question à réponse écrite"),
        ),
      )),
      el("button", { class: "btn", type: "button", onclick: () => restructure(() => draft.sections.push(blankSection())) }, "+ Ajouter une partie"),
    );
  }

  function renderPreview() {
    if (previewBox.childElementCount) return previewBox.replaceChildren();
    const { content } = toPayload(draft);
    previewBox.replaceChildren(
      el("div", { class: "alert alert-info" }, "Aperçu : voici ce que voit l'élève. Les réponses saisies ici ne sont pas enregistrées."),
      el("h2", {}, draft.title || "(sans titre)"),
      ...(draft.description.trim() ? [el("p", { class: "card info" }, draft.description.trim())] : []),
      ...sectionCards(content.sections, {}, () => {}),
    );
    previewBox.scrollIntoView({ behavior: "smooth" });
  }

  async function save(e: Event) {
    e.preventDefault();
    const { content, key } = toPayload(draft);
    saveButton.disabled = true;
    try {
      const { data, error } = await supabase.rpc("save_assignment", {
        ...(draft.id ? { p_id: draft.id } : {}),
        p_school_id: draft.school_id,
        p_title: draft.title,
        p_description: draft.description,
        p_content: content as unknown as Json,
        p_key: key as unknown as Json,
        p_classes: [...draft.issues].map(([class_id, i]) => ({
          class_id,
          is_open: i.is_open,
          due_at: i.due_at ? new Date(i.due_at).toISOString() : null,
        })),
        p_show_score_on_submit: draft.show_score_on_submit,
        p_regrade: regrade.checked,
      });
      if (error) throw error;
      if (!draft.id) {
        draft.id = data;
        history.replaceState(null, "", `/enseignant/devoirs/${draft.id}`);
      }
      dirty = false;
      showMessage(msg, draft.issues.size
        ? "Devoir enregistré."
        : "Devoir enregistré. Aucune classe n'est cochée : les élèves ne le voient pas encore.", "success");
    } catch (err) {
      showMessage(msg, errorMessage(err));
    } finally {
      saveButton.disabled = false;
    }
  }

  /** One row per class the caller teaches in the assignment's school: given or not, open, due date. */
  function renderIssues() {
    const mine = myClasses!.filter((c: TaughtClass) => c.school_id === draft.school_id);
    issuesBox.replaceChildren(el("fieldset", {},
      el("legend", {}, "Mes classes"),
      mine.length
        ? el("table", { class: "table issues" },
          el("thead", {}, el("tr", {}, ["Classe", "Ouvert", "À remettre le (optionnel)"].map((h) => el("th", {}, h)))),
          el("tbody", {}, mine.map((c) => {
            const issue = draft.issues.get(c.id);
            const open = el("input", { type: "checkbox", checked: issue?.is_open ?? true, disabled: !issue, "aria-label": `${c.code} ouvert` });
            const due = el("input", { type: "datetime-local", value: issue?.due_at ?? "", disabled: !issue, "aria-label": `${c.code} à remettre le` });
            const given = el("input", { type: "checkbox", checked: Boolean(issue) });
            given.addEventListener("change", () => {
              if (given.checked) draft.issues.set(c.id, { is_open: open.checked, due_at: due.value });
              else draft.issues.delete(c.id);
              open.disabled = due.disabled = !given.checked;
              changed();
            });
            open.addEventListener("change", () => {
              const i = draft.issues.get(c.id);
              if (i) i.is_open = open.checked;
              changed();
            });
            due.addEventListener("input", () => {
              const i = draft.issues.get(c.id);
              if (i) i.due_at = due.value;
              changed();
            });
            return el("tr", {},
              el("td", {}, el("label", { class: "check" }, given, c.code)),
              el("td", {}, open),
              el("td", {}, due),
            );
          })))
        : el("p", { class: "muted" }, "Vous n'enseignez aucune classe dans cette école."),
      el("p", { class: "muted small" }, "Fermé : les élèves voient le devoir mais ne peuvent plus remettre."),
    ));
  }

  const form = el("form", { onsubmit: save },
    el("div", { class: "card" },
      field("Titre", draft.title, (v) => (draft.title = v), { required: true, placeholder: "ex. Les verbes réciproques" }),
      field("Description pour les élèves (optionnel)", draft.description, (v) => (draft.description = v), { rows: 2 }),
      !assignment && schools.length > 1
        ? (() => {
          const school = el("select", {}, schools.map((m) => el("option", { value: m.school_id }, m.school_name)));
          school.value = draft.school_id;
          school.addEventListener("change", () => {
            draft.school_id = school.value;
            draft.issues.clear(); // classes belong to one school
            changed();
            renderIssues();
          });
          return el("label", {}, "École", school);
        })()
        : null,
      issuesBox,
      checkbox("Montrer la note automatique dès la remise", draft.show_score_on_submit, (v) => (draft.show_score_on_submit = v)),
    ),
    sectionsBox,
    el("div", { class: "card submit-bar" },
      msg,
      submissionCount
        ? el("label", { class: "check" }, regrade,
          `Recorriger automatiquement les ${submissionCount} remise(s) avec ce corrigé (vos corrections manuelles sont conservées)`)
        : null,
      el("div", { class: "toolbar" },
        editable ? saveButton : null,
        el("button", { class: "btn", type: "button", onclick: renderPreview }, "Aperçu élève"),
        link("/enseignant/devoirs", "Retour aux devoirs", "btn btn-ghost"),
      ),
    ),
  );

  // Warn before closing the tab with unsaved changes (only while this editor is on screen).
  window.addEventListener("beforeunload", function guard(e) {
    if (!form.isConnected) return window.removeEventListener("beforeunload", guard);
    if (dirty) e.preventDefault();
  });

  main.append(
    link("/enseignant/devoirs", "← Devoirs", "back"),
    el("h1", {}, !id ? "Nouveau devoir" : editable ? "Modifier le devoir" : "Devoir d'un·e collègue"),
    ...(editable ? [] : [el("div", { class: "alert alert-info" },
      "Lecture seule : seul l'auteur ou l'administration de l'école peut modifier ce devoir. ",
      "Utilisez « Dupliquer » dans la liste pour en faire votre propre copie.")]),
    ...(submissionCount ? [el("div", { class: "alert alert-info" },
        `${submissionCount} élève(s) ont déjà remis ce devoir. Corriger le corrigé, les explications ou le texte est sans risque. `,
        "Évitez de retirer ou de réordonner les choix d'une question : les réponses déjà remises sont enregistrées par position.")] : []),
    form,
    previewBox,
  );
  renderIssues();
  renderSections();
}
