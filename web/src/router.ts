import { displayName, el, showMessage } from "./dom";
import { clearMe, currentMe, errorMessage, isStaff, supabase } from "./supabase";
import { themeButton } from "./theme";
import type { Me } from "./types";

export type Params = Record<string, string>;
export type Audience = "staff" | "student";
export interface Route {
  path: string; // e.g. "/eleve/devoir/:id"
  render: (main: HTMLElement, params: Params, me: Me | null) => void | Promise<void>;
  audience?: Audience; // omitted = any signed-in user
  public?: boolean; // reachable without a session
}

let routes: Route[] = [];
let root: HTMLElement;

export function homeFor(me: Me): string {
  return isStaff(me) ? "/enseignant" : "/eleve";
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

/** Top-bar tab; highlighted when the current page is under `href`. */
function navTab(href: string, text: string, exact = false): HTMLAnchorElement {
  const here = location.pathname;
  const active = exact ? here === href : here === href || here.startsWith(`${href}/`);
  const a = link(href, text, `nav-tab${active ? " active" : ""}`);
  if (active) a.setAttribute("aria-current", "page");
  return a;
}

function header(me: Me | null): HTMLElement {
  const nav = el("nav", { class: "nav", "aria-label": "Navigation principale" });
  if (me && isStaff(me)) {
    nav.append(navTab("/enseignant", "Résultats", true), navTab("/enseignant/devoirs", "Devoirs"), navTab("/enseignant/eleves", "Élèves et classes"));
  } else if (me) {
    nav.append(navTab("/eleve", "Mes devoirs"));
  }
  const tools = el("div", { class: "nav-tools" }, themeButton());
  if (me) {
    tools.append(
      el("span", { class: "nav-user" }, displayName(me.profile) || me.profile.email),
      el("button", {
        class: "btn btn-ghost",
        type: "button",
        onclick: async () => {
          await supabase.auth.signOut();
          clearMe();
          navigate("/login", true);
        },
      }, "Déconnexion"),
    );
  }
  return el("header", { class: "topbar" },
    el("div", { class: "topbar-inner" }, el("span", { class: "brand" }, "Devoirs de français"), nav, tools));
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

  let me: Me | null = null;
  try {
    me = await currentMe();
  } catch (e) {
    console.error(e);
  }

  if (!route.public) {
    if (!me) return navigate("/login", true);
    if (me.profile.must_change_password && route.path !== "/mot-de-passe") return navigate("/mot-de-passe", true);
    if (route.audience && route.audience !== (isStaff(me) ? "staff" : "student")) return navigate(homeFor(me), true);
  } else if (me && route.path === "/login") {
    return navigate(homeFor(me), true);
  }

  const main = el("main", { class: "container" });
  root.replaceChildren(header(me), main);
  try {
    await route.render(main, params, me);
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
      clearMe();
      if (location.pathname !== "/login") navigate("/login", true);
    }
  });
  void render();
}
