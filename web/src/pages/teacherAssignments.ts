import { confirmButton, el, formatDate, showMessage } from "../dom";
import { link, navigate, type Params } from "../router";
import { errorMessage, supabase } from "../supabase";
import type { AnswerKey, Assignment, ClassRow, KeyEntry, Question, Section } from "../types";
import { sectionCards } from "./student";

// ---------------------------------------------------------------------------------------------
// List

interface AssignmentRow {
  id: string;
  title: string;
  is_open: boolean;
  due_at: string | null;
  assignment_classes: { class_id: string }[];
  submissions: { count: number }[];
}

export async function renderTeacherAssignments(main: HTMLElement) {
  const [{ data: classes, error: e1 }, { data, error: e2 }] = await Promise.all([
    supabase.from("classes").select("id, code, name").order("code"),
    supabase
      .from("assignments")
      .select("id, title, is_open, due_at, assignment_classes(class_id), submissions(count)")
      .order("created_at", { ascending: false }),
  ]);
  if (e1 || e2) throw e1 ?? e2;
  const codes = new Map((classes as ClassRow[]).map((c) => [c.id, c.code]));
  const assignments = data as unknown as AssignmentRow[];
  const msg = el("div");

  main.append(
    el("h1", {}, "Devoirs"),
    el("div", { class: "toolbar" }, link("/enseignant/devoirs/nouveau", "+ Nouveau devoir", "btn btn-primary")),
    msg,
  );
  if (!assignments.length) {
    main.append(el("p", { class: "muted" }, "Aucun devoir. Créez-en un pour commencer."));
    return;
  }

  main.append(el("table", { class: "table" },
    el("thead", {}, el("tr", {}, ["Devoir", "Classes", "État", "À remettre", "Remises", ""].map((h) => el("th", {}, h)))),
    el("tbody", {}, assignments.map((a) => {
      const count = a.submissions[0]?.count ?? 0;
      const classList = a.assignment_classes.map((ac) => codes.get(ac.class_id)).filter(Boolean).sort();
      return el("tr", {},
        el("td", {}, link(`/enseignant/devoirs/${a.id}`, a.title)),
        el("td", { class: "nowrap" }, classList.length ? classList.join(", ") : el("span", { class: "badge badge-review" }, "Aucune classe")),
        el("td", {}, el("span", { class: `badge ${a.is_open ? "badge-returned" : "badge-closed"}` }, a.is_open ? "Ouvert" : "Fermé")),
        el("td", { class: "muted" }, formatDate(a.due_at)),
        el("td", {}, String(count)),
        el("td", { class: "actions" },
          link(`/enseignant/devoirs/${a.id}`, "Modifier", "btn btn-small"),
          el("button", {
            class: "btn btn-small",
            type: "button",
            onclick: async () => {
              const { error } = await supabase.from("assignments").update({ is_open: !a.is_open }).eq("id", a.id);
              if (error) return showMessage(msg, errorMessage(error));
              navigate("/enseignant/devoirs", true);
            },
          }, a.is_open ? "Fermer" : "Ouvrir"),
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
          confirmButton(
            "Supprimer",
            count ? `Supprimer ce devoir et les ${count} remise(s) des élèves ?` : "Supprimer ce devoir ?",
            async () => {
              const { error } = await supabase.from("assignments").delete().eq("id", a.id);
              if (error) return showMessage(msg, errorMessage(error));
              navigate("/enseignant/devoirs", true);
            },
            "btn btn-small btn-danger-outline",
          ),
        ),
      );
    })),
  ));
}

/** Copies an assignment (questions + key) as a closed draft with no classes, so it can be adapted. */
async function duplicate(id: string): Promise<string> {
  const [{ data: a, error: e1 }, { data: k, error: e2 }] = await Promise.all([
    supabase.from("assignments").select("*").eq("id", id).single(),
    supabase.from("answer_keys").select("key").eq("assignment_id", id).maybeSingle(),
  ]);
  if (e1 || e2) throw e1 ?? e2;
  const { data, error } = await supabase.rpc("save_assignment", {
    p_id: null,
    p_title: `Copie de ${a.title}`,
    p_description: a.description,
    p_content: a.content,
    p_key: k?.key ?? {},
    p_class_ids: [],
    p_is_open: false,
    p_due_at: null,
    p_show_score_on_submit: a.show_score_on_submit,
  });
  if (error) throw error;
  return data as string;
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

interface Draft {
  id: string | null;
  title: string;
  description: string;
  is_open: boolean;
  due_at: string; // <input type="datetime-local"> value, local time
  show_score_on_submit: boolean;
  class_ids: Set<string>;
  sections: DraftSection[];
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

function toDraft(a: Assignment | null, key: AnswerKey, classIds: string[]): Draft {
  if (!a) {
    return {
      id: null, title: "", description: "", is_open: true, due_at: "", show_score_on_submit: true,
      class_ids: new Set(classIds), sections: [blankSection()],
    };
  }
  return {
    id: a.id,
    title: a.title,
    description: a.description ?? "",
    is_open: a.is_open,
    due_at: toLocalInput(a.due_at),
    show_score_on_submit: a.show_score_on_submit,
    class_ids: new Set(classIds),
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

export async function renderTeacherAssignmentEditor(main: HTMLElement, params: Params) {
  const id = params.id ?? null;
  const { data: classes, error } = await supabase.from("classes").select("id, code, name").order("code");
  if (error) throw error;

  let assignment: Assignment | null = null;
  let key: AnswerKey = {};
  let classIds: string[] = [];
  let submissionCount = 0;
  if (id) {
    const [a, k, ac, subs] = await Promise.all([
      supabase.from("assignments").select("*").eq("id", id).single(),
      supabase.from("answer_keys").select("key").eq("assignment_id", id).maybeSingle(),
      supabase.from("assignment_classes").select("class_id").eq("assignment_id", id),
      supabase.from("submissions").select("id", { count: "exact", head: true }).eq("assignment_id", id),
    ]);
    const failed = a.error ?? k.error ?? ac.error ?? subs.error;
    if (failed) throw failed;
    assignment = a.data as Assignment;
    key = (k.data?.key ?? {}) as AnswerKey;
    classIds = (ac.data ?? []).map((r) => r.class_id as string);
    submissionCount = subs.count ?? 0;
  }

  const draft = toDraft(assignment, key, classIds);
  let dirty = false;
  const changed = () => {
    dirty = true;
  };

  const msg = el("div");
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
        p_id: draft.id,
        p_title: draft.title,
        p_description: draft.description,
        p_content: content,
        p_key: key,
        p_class_ids: [...draft.class_ids],
        p_is_open: draft.is_open,
        p_due_at: draft.due_at ? new Date(draft.due_at).toISOString() : null,
        p_show_score_on_submit: draft.show_score_on_submit,
        p_regrade: regrade.checked,
      });
      if (error) throw error;
      if (!draft.id) {
        draft.id = data as string;
        history.replaceState(null, "", `/enseignant/devoirs/${draft.id}`);
      }
      dirty = false;
      showMessage(msg, draft.class_ids.size
        ? "Devoir enregistré."
        : "Devoir enregistré. Aucune classe n'est cochée : les élèves ne le voient pas encore.", "success");
    } catch (err) {
      showMessage(msg, errorMessage(err));
    } finally {
      saveButton.disabled = false;
    }
  }

  const form = el("form", { onsubmit: save },
    el("div", { class: "card" },
      field("Titre", draft.title, (v) => (draft.title = v), { required: true, placeholder: "ex. Les verbes réciproques" }),
      field("Description pour les élèves (optionnel)", draft.description, (v) => (draft.description = v), { rows: 2 }),
      el("fieldset", { class: "class-picks" },
        el("legend", {}, "Classes"),
        (classes as ClassRow[]).map((c) => checkbox(c.code, draft.class_ids.has(c.id), (on) => {
          if (on) draft.class_ids.add(c.id);
          else draft.class_ids.delete(c.id);
        })),
      ),
      el("div", { class: "filters" },
        (() => {
          const due = el("input", { type: "datetime-local", value: draft.due_at });
          due.addEventListener("input", () => {
            draft.due_at = due.value;
            changed();
          });
          return el("label", {}, "À remettre le (optionnel)", due);
        })(),
      ),
      checkbox("Ouvert : les élèves peuvent remettre leurs réponses", draft.is_open, (v) => (draft.is_open = v)),
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
        saveButton,
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
    el("h1", {}, id ? "Modifier le devoir" : "Nouveau devoir"),
    ...(submissionCount ? [el("div", { class: "alert alert-info" },
        `${submissionCount} élève(s) ont déjà remis ce devoir. Corriger le corrigé, les explications ou le texte est sans risque. `,
        "Évitez de retirer ou de réordonner les choix d'une question : les réponses déjà remises sont enregistrées par position.")] : []),
    form,
    previewBox,
  );
  renderSections();
}
