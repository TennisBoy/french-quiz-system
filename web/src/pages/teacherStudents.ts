import { confirmButton, downloadCsv, el, fullName, showMessage } from "../dom";
import { callFunction, errorMessage, supabase } from "../supabase";
import type { ClassRow, Profile } from "../types";

interface CreateResult {
  email: string;
  status: "created" | "exists" | "invalid" | "error";
  temp_password?: string;
  message?: string;
}

const STATUS_TEXT: Record<CreateResult["status"], string> = {
  created: "Créé",
  exists: "Existe déjà",
  invalid: "Invalide",
  error: "Erreur",
};

/**
 * Accepts lines of "courriel, prénom, nom" (comma, semicolon or tab separated, e.g. pasted from a
 * spreadsheet). The email may be in any column; the other two cells are read as prénom then nom.
 */
function parseRoster(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/[,;\t]/).map((c) => c.trim()))
    .filter((cells) => cells.some(Boolean))
    .filter((cells) => !cells.some((c) => /^(courriel|e-?mail)$/i.test(c))) // header row
    .map((cells) => {
      const at = cells.findIndex((c) => c.includes("@"));
      const email = at >= 0 ? cells[at] : cells[0] ?? "";
      const [first_name = "", last_name = ""] = cells.filter((c, i) => i !== (at >= 0 ? at : 0) && c);
      return { email, first_name, last_name };
    });
}

export async function renderTeacherStudents(main: HTMLElement) {
  main.append(el("h1", {}, "Élèves et classes"));
  const classesBox = el("div");
  const rosterBox = el("div");
  main.append(classesBox, rosterBox);

  let classes: ClassRow[] = [];
  let selected = "";
  // One-time password list from the last create-students call; survives the roster refresh.
  let lastCreated: CreateResult[] | null = null;

  async function loadClasses() {
    const { data, error } = await supabase.from("classes").select("id, code, name").order("code");
    if (error) throw error;
    classes = data as ClassRow[];
    if (!classes.some((c) => c.id === selected)) selected = classes[0]?.id ?? "";

    const msg = el("div");
    const code = el("input", { type: "text", placeholder: "ex. FSF3U7-3", required: true });
    const name = el("input", { type: "text", placeholder: "Description (optionnel)" });
    const select = el("select", { onchange: (e: Event) => {
      selected = (e.target as HTMLSelectElement).value;
      lastCreated = null;
      void loadRoster();
    } },
      classes.map((c) => el("option", { value: c.id }, c.code)));
    select.value = selected;

    classesBox.replaceChildren(el("div", { class: "card" },
      el("h2", {}, "Classes"),
      classes.length ? el("label", {}, "Classe affichée", select) : el("p", { class: "muted" }, "Aucune classe."),
      el("form", {
        class: "inline-form",
        onsubmit: async (e: Event) => {
          e.preventDefault();
          const { data: created, error } = await supabase.from("classes")
            .insert({ code: code.value.trim(), name: name.value.trim() || null }).select("id").single();
          if (error) return showMessage(msg, error.code === "23505" ? "Ce code de classe existe déjà." : errorMessage(error));
          selected = created.id;
          await loadClasses();
        },
      }, code, name, el("button", { class: "btn", type: "submit" }, "Ajouter une classe")),
      msg,
    ));
    await loadRoster();
  }

  async function loadRoster() {
    if (!selected) return rosterBox.replaceChildren();
    const { data, error } = await supabase.from("profiles").select("*").eq("class_id", selected).eq("role", "student").order("last_name");
    if (error) return showMessage(rosterBox, errorMessage(error));
    const students = data as Profile[];
    const msg = el("div");
    const classCode = classes.find((c) => c.id === selected)?.code ?? "";

    const rows = students.map((p) => {
      const pwCell = el("td", {});
      const moveSelect = el("select", {
        onchange: async (e: Event) => {
          const { error } = await supabase.from("profiles").update({ class_id: (e.target as HTMLSelectElement).value }).eq("id", p.id);
          if (error) return showMessage(msg, errorMessage(error));
          await loadRoster();
        },
      }, classes.map((c) => el("option", { value: c.id }, c.code)));
      moveSelect.value = selected;
      return el("tr", {},
        el("td", {}, fullName(p)),
        el("td", { class: "muted" }, p.email),
        el("td", {}, p.must_change_password ? el("span", { class: "badge badge-todo" }, "Mot de passe temporaire") : "Actif"),
        el("td", {}, moveSelect),
        el("td", {}, confirmButton("Réinitialiser le mot de passe", "Nouveau mot de passe temporaire ?", async () => {
          try {
            const r = await callFunction<{ temp_password: string }>("reset-password", { student_id: p.id });
            pwCell.replaceChildren(el("code", {}, r.temp_password));
          } catch (e) {
            showMessage(msg, errorMessage(e));
          }
        }, "btn btn-small")),
        pwCell,
      );
    });

    const roster = el("textarea", { rows: 6, placeholder: "123456789@tdsb.ca, Léa, Gagnon\n123456790@tdsb.ca, Lucas, Tremblay" });
    const results = el("div");
    const addButton = el("button", { class: "btn btn-primary", type: "submit" }, "Créer les comptes");

    rosterBox.replaceChildren(
      el("div", { class: "card" },
        el("h2", {}, `Élèves de ${classCode} (${students.length})`),
        msg,
        students.length
          ? el("table", { class: "table" },
            el("thead", {}, el("tr", {}, ["Élève", "Courriel", "Compte", "Classe", "", ""].map((h) => el("th", {}, h)))),
            el("tbody", {}, rows))
          : el("p", { class: "muted" }, "Aucun élève dans cette classe."),
      ),
      el("form", {
        class: "card",
        onsubmit: async (e: Event) => {
          e.preventDefault();
          const students = parseRoster(roster.value);
          if (!students.length) return showMessage(results, "Collez au moins une ligne.");
          addButton.disabled = true;
          try {
            const { results: created } = await callFunction<{ results: CreateResult[] }>("create-students", { class_id: selected, students });
            lastCreated = created;
            await loadRoster();
          } catch (err) {
            showMessage(results, errorMessage(err));
          } finally {
            addButton.disabled = false;
          }
        },
      },
        el("h2", {}, `Ajouter des élèves à ${classCode}`),
        el("p", { class: "muted" }, "Une ligne par élève : courriel, prénom, nom. Vous pouvez coller directement depuis un tableur."),
        roster,
        addButton,
        results,
      ),
    );
    if (lastCreated) renderCreated(results, classCode, lastCreated);
  }

  await loadClasses();
}

function renderCreated(container: HTMLElement, classCode: string, results: CreateResult[]) {
  const created = results.filter((r) => r.status === "created");
  container.replaceChildren(
    el("div", { class: "alert alert-info" },
      "Les mots de passe temporaires ne s'affichent qu'une seule fois. Imprimez ou téléchargez la liste maintenant."),
    el("div", { class: "toolbar no-print" },
      el("button", { class: "btn", type: "button", onclick: () => window.print() }, "Imprimer"),
      el("button", {
        class: "btn",
        type: "button",
        onclick: () => downloadCsv(`comptes-${classCode}.csv`, [["Courriel", "Mot de passe temporaire"], ...created.map((r) => [r.email, r.temp_password])]),
      }, "Télécharger CSV"),
    ),
    el("table", { class: "table printable" },
      el("thead", {}, el("tr", {}, ["Courriel", "Résultat", "Mot de passe temporaire"].map((h) => el("th", {}, h)))),
      el("tbody", {}, results.map((r) => el("tr", {},
        el("td", {}, r.email),
        el("td", {}, STATUS_TEXT[r.status], r.message ? ` : ${r.message}` : ""),
        el("td", {}, r.temp_password ? el("code", {}, r.temp_password) : ""),
      ))),
    ),
  );
}
