import { confirmButton, displayName, downloadCsv, el, fullName, showMessage } from "../dom";
import type { Params } from "../router";
import { adminSchools, callFunction, errorMessage, staffSchools, supabase } from "../supabase";
import type { Me, Membership, Profile, TaughtClass } from "../types";
import { classLabel } from "./classes";

interface CreateResult {
  email: string;
  status: "created" | "enrolled" | "exists" | "invalid" | "error";
  temp_password?: string;
  message?: string;
}

const STATUS_TEXT: Record<CreateResult["status"], string> = {
  created: "Créé",
  enrolled: "Ajouté à la classe",
  exists: "Existe déjà",
  invalid: "Invalide",
  error: "Erreur",
};

/**
 * Accepts lines of "courriel, prénom, nom[, titre]" (comma, semicolon or tab separated, e.g. pasted
 * from a spreadsheet). The email may be in any column; the other cells are read in order.
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
      const [first_name = "", last_name = "", honorific = ""] = cells.filter((c, i) => i !== (at >= 0 ? at : 0) && c);
      return { email, first_name, last_name, honorific };
    });
}

/** One-time password list; survives roster refreshes until the class changes. */
function createdTable(container: HTMLElement, label: string, results: CreateResult[]) {
  const created = results.filter((r) => r.status === "created");
  container.replaceChildren(
    el("div", { class: "alert alert-info" },
      "Les mots de passe temporaires ne s'affichent qu'une seule fois. Imprimez ou téléchargez la liste maintenant."),
    el("div", { class: "toolbar no-print" },
      el("button", { class: "btn", type: "button", onclick: () => window.print() }, "Imprimer"),
      el("button", {
        class: "btn",
        type: "button",
        onclick: () => downloadCsv(`comptes-${label}.csv`, [["Courriel", "Mot de passe temporaire"], ...created.map((r) => [r.email, r.temp_password])]),
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

function resetButton(userId: string, pwCell: HTMLElement, msg: HTMLElement) {
  return confirmButton("Réinitialiser le mot de passe", "Nouveau mot de passe temporaire ?", async () => {
    try {
      const r = await callFunction<{ temp_password: string }>("reset-password", { user_id: userId });
      pwCell.replaceChildren(el("code", {}, r.temp_password));
    } catch (e) {
      showMessage(msg, errorMessage(e));
    }
  }, "btn btn-small");
}

/** Roster form posting to create-accounts; `extra` is role + class_id or school_id. */
function accountsForm(title: string, hint: string, placeholder: string, label: string, extra: Record<string, unknown>, onDone: (r: CreateResult[]) => Promise<void>) {
  const roster = el("textarea", { rows: 5, placeholder });
  const results = el("div");
  const addButton = el("button", { class: "btn btn-primary", type: "submit" }, "Créer les comptes");
  const form = el("form", {
    class: "card",
    onsubmit: async (e: Event) => {
      e.preventDefault();
      const accounts = parseRoster(roster.value);
      if (!accounts.length) return showMessage(results, "Collez au moins une ligne.");
      addButton.disabled = true;
      try {
        const { results: created } = await callFunction<{ results: CreateResult[] }>("create-accounts", { ...extra, accounts });
        roster.value = "";
        await onDone(created);
      } catch (err) {
        showMessage(results, errorMessage(err));
      } finally {
        addButton.disabled = false;
      }
    },
  }, el("h2", {}, title), el("p", { class: "muted" }, hint), roster, addButton, results);
  return { form, show: (r: CreateResult[]) => createdTable(results, label, r) };
}

export async function renderTeacherStudents(main: HTMLElement, _params: Params, me: Me | null) {
  if (!me) return;
  main.append(el("h1", {}, "Élèves et classes"));
  const classesBox = el("div");
  const rosterBox = el("div");
  const staffBox = el("div");
  main.append(classesBox, rosterBox, staffBox);

  let classes: TaughtClass[] = [];
  let selected = "";
  let lastCreated: CreateResult[] | null = null;

  async function loadClasses() {
    const { data, error } = await supabase.rpc("my_classes");
    if (error) throw error;
    classes = data;
    if (!classes.some((c) => c.id === selected)) selected = classes[0]?.id ?? "";

    const msg = el("div");
    const schools = staffSchools(me!);
    const schoolSelect = el("select", { "aria-label": "École" }, schools.map((s) => el("option", { value: s.school_id }, s.school_name)));
    const code = el("input", { type: "text", placeholder: "ex. FSF3U7-3", required: true, "aria-label": "Code de la classe" });
    const name = el("input", { type: "text", placeholder: "Description (optionnel)", "aria-label": "Description" });
    const select = el("select", { onchange: (e: Event) => {
      selected = (e.target as HTMLSelectElement).value;
      lastCreated = null;
      void loadRoster();
    } }, classes.map((c) => el("option", { value: c.id }, classLabel(c, classes))));
    select.value = selected;

    classesBox.replaceChildren(el("div", { class: "card" },
      el("h2", {}, "Mes classes"),
      classes.length ? el("label", {}, "Classe affichée", select) : el("p", { class: "muted" }, "Aucune classe."),
      el("form", {
        class: "inline-form",
        onsubmit: async (e: Event) => {
          e.preventDefault();
          const { data: id, error } = await supabase.rpc("create_class", {
            p_school_id: schoolSelect.value, p_code: code.value, p_name: name.value,
          });
          if (error) return showMessage(msg, errorMessage(error));
          selected = id;
          await loadClasses();
        },
      }, schools.length > 1 ? schoolSelect : null, code, name, el("button", { class: "btn", type: "submit" }, "Ajouter une classe")),
      msg,
    ));
    await loadRoster();
  }

  async function loadRoster() {
    const cls = classes.find((c) => c.id === selected);
    if (!cls) return rosterBox.replaceChildren();
    const { data, error } = await supabase.from("enrollments").select("profiles(*)").eq("class_id", cls.id);
    if (error) return showMessage(rosterBox, errorMessage(error));
    const students = data.flatMap((e) => (e.profiles ? [e.profiles as Profile] : []))
      .sort((a, b) => a.last_name.localeCompare(b.last_name, "fr"));
    const sameSchool = classes.filter((c) => c.school_id === cls.school_id);
    const msg = el("div");

    const rows = students.map((p) => {
      const pwCell = el("td", {});
      const moveSelect = el("select", {
        "aria-label": `Classe de ${fullName(p)}`,
        onchange: async (e: Event) => {
          const { error } = await supabase.from("enrollments")
            .update({ class_id: (e.target as HTMLSelectElement).value })
            .eq("class_id", cls.id).eq("student_id", p.id);
          if (error) return showMessage(msg, error.code === "23505" ? "L'élève est déjà dans cette classe." : errorMessage(error));
          await loadRoster();
        },
      }, sameSchool.map((c) => el("option", { value: c.id }, c.code)));
      moveSelect.value = cls.id;
      return el("tr", {},
        el("td", {}, fullName(p)),
        el("td", { class: "muted" }, p.email),
        el("td", {}, p.must_change_password ? el("span", { class: "badge badge-todo" }, "Mot de passe temporaire") : "Actif"),
        el("td", {}, moveSelect),
        el("td", { class: "actions" },
          resetButton(p.id, pwCell, msg),
          confirmButton("Retirer", `Retirer ${fullName(p)} de ${cls.code} ? Son compte et ses remises sont conservés.`, async () => {
            const { error } = await supabase.from("enrollments").delete().eq("class_id", cls.id).eq("student_id", p.id);
            if (error) return showMessage(msg, errorMessage(error));
            await loadRoster();
          }, "btn btn-small btn-danger-outline"),
        ),
        pwCell,
      );
    });

    const { form, show } = accountsForm(
      `Ajouter des élèves à ${cls.code}`,
      "Une ligne par élève : courriel, prénom, nom. Vous pouvez coller directement depuis un tableur. Un élève qui a déjà un compte dans l'école est simplement ajouté à la classe.",
      "123456789@tdsb.ca, Léa, Gagnon\n123456790@tdsb.ca, Lucas, Tremblay",
      cls.code,
      { role: "student", class_id: cls.id },
      async (created) => {
        lastCreated = created;
        await loadRoster();
      },
    );

    rosterBox.replaceChildren(
      el("div", { class: "card" },
        el("h2", {}, `Élèves de ${cls.code} (${students.length})`),
        msg,
        students.length
          ? el("table", { class: "table" },
            el("thead", {}, el("tr", {}, ["Élève", "Courriel", "Compte", "Classe", "", ""].map((h) => el("th", {}, h)))),
            el("tbody", {}, rows))
          : el("p", { class: "muted" }, "Aucun élève dans cette classe."),
      ),
      form,
    );
    if (lastCreated) show(lastCreated);
  }

  async function loadStaff(school: Membership, box: HTMLElement, lastStaff: CreateResult[] | null = null) {
    const { data, error } = await supabase.from("school_members").select("role, profiles(*)")
      .eq("school_id", school.school_id).in("role", ["admin", "teacher"]);
    if (error) return showMessage(box, errorMessage(error));
    const staff = data.flatMap((m) => (m.profiles ? [{ role: m.role, p: m.profiles }] : []))
      .sort((a, b) => a.p.last_name.localeCompare(b.p.last_name, "fr"));
    const msg = el("div");
    const { form, show } = accountsForm(
      "Ajouter des enseignants",
      "Une ligne par enseignant : courriel, prénom, nom, titre (ex. Mme, M., Ms.). Le titre sert à l'affichage : « Mme Dupont ».",
      "marie.dupont@tdsb.on.ca, Marie, Dupont, Mme",
      "enseignants",
      { role: "teacher", school_id: school.school_id },
      (created) => loadStaff(school, box, created),
    );
    box.replaceChildren(
      el("div", { class: "card" },
        el("h2", {}, `Enseignants — ${school.school_name}`),
        msg,
        el("table", { class: "table" },
          el("thead", {}, el("tr", {}, ["Nom", "Courriel", "Rôle", "", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, staff.map(({ role, p }) => {
            const pwCell = el("td", {});
            return el("tr", {},
              el("td", {}, displayName(p)),
              el("td", { class: "muted" }, p.email),
              el("td", {}, role === "admin" ? "Administration" : "Enseignant·e"),
              el("td", {}, role === "teacher" ? resetButton(p.id, pwCell, msg) : null),
              pwCell,
            );
          })),
        ),
      ),
      form,
    );
    if (lastStaff) show(lastStaff);
  }

  await loadClasses();
  // School admins also manage the teachers of their school.
  for (const school of adminSchools(me)) {
    const box = el("div");
    staffBox.append(box);
    await loadStaff(school, box);
  }
}
