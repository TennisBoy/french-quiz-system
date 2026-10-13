// Tiny DOM builder. All text goes through text nodes, never innerHTML: student answers are shown
// on the teacher's screen, so rendering them as HTML would let a student run script as the teacher.

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") {
      node.addEventListener(name.slice(2), value);
    } else if (name === "class") {
      node.className = String(value);
    } else if (name === "value" && "value" in node) {
      (node as HTMLInputElement).value = String(value);
    } else if (name === "checked" && "checked" in node) {
      (node as HTMLInputElement).checked = Boolean(value);
    } else {
      node.setAttribute(name, value === true ? "" : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/** Inline message box; replaces any previous message in `container`. */
export function showMessage(container: HTMLElement, text: string, kind: "error" | "success" | "info" = "error") {
  container.replaceChildren(el("div", { class: `alert alert-${kind}`, role: kind === "error" ? "alert" : "status" }, text));
}

/**
 * Two-step confirmation without window.confirm(): the button is replaced by a
 * "Confirmer / Annuler" pair until the user decides.
 */
export function confirmButton(label: string, question: string, onConfirm: () => void | Promise<void>, cls = "btn") {
  const wrap = el("span", { class: "confirm" });
  const reset = () => wrap.replaceChildren(button);
  const button = el("button", {
    class: cls,
    type: "button",
    onclick: () =>
      wrap.replaceChildren(
        el("span", { class: "confirm-question" }, question),
        el("button", { class: "btn btn-danger", type: "button", onclick: async () => { reset(); await onConfirm(); } }, "Confirmer"),
        el("button", { class: "btn btn-ghost", type: "button", onclick: reset }, "Annuler"),
      ),
  }, label);
  reset();
  return wrap;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("fr-CA", { dateStyle: "medium", timeStyle: "short" });
}

export function fullName(p: { first_name: string; last_name: string }): string {
  return `${p.first_name} ${p.last_name}`.trim();
}

/** How the app addresses someone: "Ms. Stewart" when an honorific is set, else the full name. */
export function displayName(p: { first_name: string; last_name: string; honorific?: string | null }): string {
  return p.honorific && p.last_name ? `${p.honorific} ${p.last_name}` : fullName(p);
}

/** CSV cell, quoted, and neutralized against spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
