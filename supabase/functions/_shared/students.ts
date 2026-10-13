export interface StudentInput {
  email: string;
  first_name: string;
  last_name: string;
}

const STUDENT_EMAIL_DOMAIN = (Deno.env.get("STUDENT_EMAIL_DOMAIN") ?? "tdsb.ca").toLowerCase();

/** Normalizes and validates one roster row. Returns the cleaned row, or an error message. */
export function validateStudent(raw: unknown): StudentInput | string {
  if (typeof raw !== "object" || raw === null) return "Ligne invalide";
  const r = raw as Record<string, unknown>;
  const email = String(r.email ?? "").trim().toLowerCase();
  const first_name = String(r.first_name ?? "").trim();
  const last_name = String(r.last_name ?? "").trim();

  const [local, domain, ...rest] = email.split("@");
  if (!local || domain !== STUDENT_EMAIL_DOMAIN || rest.length > 0 || /\s/.test(email)) {
    return `Courriel invalide (format attendu : numéro@${STUDENT_EMAIL_DOMAIN})`;
  }
  if (!first_name || !last_name) return "Prénom et nom requis";
  return { email, first_name, last_name };
}
