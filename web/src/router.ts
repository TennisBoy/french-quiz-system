import { el, showMessage, fullName } from "./dom";
import { clearProfile, currentProfile, errorMessage, supabase } from "./supabase";
import { themeButton } from "./theme";
import type { Profile, Role } from "./types";

export type Params = Record<string, string>;
export interface Route {
  path: string; // e.g. "/eleve/devoir/:id"
  render: (main: HTMLElement, params: Params, profile: Profile | null) => void | Promise<void>;
  role?: Role; // required role; omitted = any signed-in user
  public?: boolean; // reachable without a session
}

let routes: Route[] = [];
let root: HTMLElement;

export function homeFor(profile: Profile): string {
  return profile.role === "teacher" ? "/enseignant" : "/eleve";
}

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  void render();
}

function match(path: string): { route: Route; params: Params } | null {
  for (const route of routes) {
    const names: string[] = [];
    const pattern = route.path.replace(/:(\w+)/g, (_, n: string) => (names.push(n), "([^/]+)"));
    const m = new RegExp(`^${pattern}/?$`).exec(path);
    if (m) return { route, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

function header(profile: Profile | null): HTMLElement {
  const nav = el("nav", { class: "nav" });
  if (profile?.role === "teacher") {
    nav.append(link("/enseignant", "Résultats"), link("/enseignant/devoirs", "Devoirs"), link("/enseignant/eleves", "Élèves et classes"));
  } else if (profile) {
    nav.append(link("/eleve", "Mes devoirs"));
  }
  nav.append(themeButton());
  if (profile) {
    nav.append(
      el("span", { class: "nav-user" }, fullName(profile) || profile.email),
      el("button", {
        class: "btn btn-ghost",
        type: "button",
        onclick: async () => {
          await supabase.auth.signOut();
          clearProfile();
          navigate("/login", true);
        },
      }, "Déconnexion"),
    );
  }
  return el("header", { class: "topbar" }, el("div", { class: "topbar-inner" }, el("span", { class: "brand" }, "Devoirs de français"), nav));
}

export function link(href: string, text: string, cls = ""): HTMLAnchorElement {
  return el("a", {
    href,
    class: cls,
    onclick: (e: Event) => {
      e.preventDefault();
      navigate(href);
    },
  }, text);
}

async function render() {
  const found = match(location.pathname);
  if (!found) return navigate("/login", true);
  const { route, params } = found;

  let profile: Profile | null = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) profile = await currentProfile();
  } catch (e) {
    console.error(e);
  }

  if (!route.public) {
    if (!profile) return navigate("/login", true);
    if (profile.must_change_password && route.path !== "/mot-de-passe") return navigate("/mot-de-passe", true);
    if (route.role && route.role !== profile.role) return navigate(homeFor(profile), true);
  } else if (profile && route.path === "/login") {
    return navigate(homeFor(profile), true);
  }

  const main = el("main", { class: "container" });
  root.replaceChildren(header(profile), main);
  try {
    await route.render(main, params, profile);
  } catch (e) {
    console.error(e);
    showMessage(main, `Erreur : ${errorMessage(e)}`);
  }
}

export function startRouter(appRoot: HTMLElement, appRoutes: Route[]) {
  root = appRoot;
  routes = appRoutes;
  window.addEventListener("popstate", () => void render());
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      clearProfile();
      if (location.pathname !== "/login") navigate("/login", true);
    }
  });
  void render();
}
