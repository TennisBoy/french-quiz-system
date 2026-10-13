import { el } from "./dom";

// Light / dark / system theme. "system" removes data-theme so style.css follows prefers-color-scheme.
// The choice is a per-browser convenience, so it lives in localStorage.

type Theme = "system" | "light" | "dark";
const KEY = "theme";
const ORDER: Theme[] = ["system", "light", "dark"];
const LABEL: Record<Theme, string> = { system: "◐ Système", light: "☀ Clair", dark: "☾ Sombre" };

function stored(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    // storage unavailable (private mode); fall back to the system theme
  }
  return "system";
}

let current: Theme = "system";

function apply(theme: Theme) {
  current = theme;
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** Call once at startup, before the first render. */
export function initTheme() {
  apply(stored());
}

/** Button in the top bar that cycles Système → Clair → Sombre. */
export function themeButton(): HTMLButtonElement {
  const button = el("button", { class: "btn btn-ghost theme-toggle", type: "button" });
  const show = (theme: Theme) => {
    button.textContent = LABEL[theme];
    button.title = `Thème : ${LABEL[theme].slice(2)} (cliquer pour changer)`;
    button.setAttribute("aria-label", button.title);
  };
  button.addEventListener("click", () => {
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // not persisted; still applied for this page view
    }
    apply(next);
    show(next);
  });
  show(current);
  return button;
}
