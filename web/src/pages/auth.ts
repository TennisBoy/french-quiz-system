import { el, showMessage } from "../dom";
import { homeFor, navigate } from "../router";
import { currentMe, errorMessage, supabase } from "../supabase";

export function renderLogin(main: HTMLElement) {
  const msg = el("div");
  const email = el("input", { type: "email", name: "email", required: true, autocomplete: "username", placeholder: "123456789@tdsb.ca" });
  const password = el("input", { type: "password", name: "password", required: true, autocomplete: "current-password" });
  const submit = el("button", { class: "btn btn-primary", type: "submit" }, "Se connecter");

  const form = el("form", {
    class: "card narrow",
    onsubmit: async (e: Event) => {
      e.preventDefault();
      submit.disabled = true;
      const { error } = await supabase.auth.signInWithPassword({
        email: email.value.trim().toLowerCase(),
        password: password.value,
      });
      submit.disabled = false;
      if (error) {
        showMessage(msg, error.message === "Invalid login credentials" ? "Courriel ou mot de passe incorrect." : error.message);
        return;
      }
      const me = await currentMe(true);
      navigate(me ? homeFor(me) : "/login", true);
    },
  },
    el("h1", {}, "Connexion"),
    el("p", { class: "muted" }, "Utilisez le courriel et le mot de passe donnés par votre enseignante."),
    msg,
    el("label", {}, "Courriel", email),
    el("label", {}, "Mot de passe", password),
    submit,
    el("p", { class: "muted small" }, "Mot de passe oublié ? Demandez à votre enseignante de le réinitialiser."),
  );
  main.append(form);
}

export function renderChangePassword(main: HTMLElement) {
  const msg = el("div");
  const pw = el("input", { type: "password", required: true, minlength: 8, autocomplete: "new-password" });
  const pw2 = el("input", { type: "password", required: true, minlength: 8, autocomplete: "new-password" });
  const submit = el("button", { class: "btn btn-primary", type: "submit" }, "Enregistrer");

  main.append(el("form", {
    class: "card narrow",
    onsubmit: async (e: Event) => {
      e.preventDefault();
      if (pw.value !== pw2.value) return showMessage(msg, "Les deux mots de passe ne correspondent pas.");
      submit.disabled = true;
      try {
        const { error } = await supabase.auth.updateUser({ password: pw.value });
        if (error) throw error;
        // The database clears must_change_password when the password changes.
        const me = await currentMe(true);
        navigate(me ? homeFor(me) : "/login", true);
      } catch (err) {
        showMessage(msg, errorMessage(err));
        submit.disabled = false;
      }
    },
  },
    el("h1", {}, "Choisissez votre mot de passe"),
    el("p", { class: "muted" }, "Au moins 8 caractères. N'utilisez pas votre mot de passe TDSB."),
    msg,
    el("label", {}, "Nouveau mot de passe", pw),
    el("label", {}, "Confirmer le mot de passe", pw2),
    submit,
  ));
}
