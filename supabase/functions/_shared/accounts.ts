export interface AccountInput {
  email: string;
  first_name: string;
  last_name: string;
  honorific: string | null;
}

/**
 * Normalizes and validates one roster row against the school's email domain.
 * Returns the cleaned row, or an error message (French, shown to the teacher).
 */
export function validateAccount(raw: unknown, domain: string): AccountInput | string {
  if (typeof raw !== "object" || raw === null) return "Ligne invalide";
  const r = raw as Record<string, unknown>;
  const email = String(r.email ?? "").trim().toLowerCase();
  const first_name = String(r.first_name ?? "").trim();
  const last_name = String(r.last_name ?? "").trim();
  const honorific = String(r.honorific ?? "").trim() || null;

  const [local, emailDomain, ...rest] = email.split("@");
  if (!local || emailDomain !== domain.toLowerCase() || rest.length > 0 || /\s/.test(email)) {
    return `Courriel invalide (domaine attendu : @${domain})`;
  }
  if (!first_name || !last_name) return "Prénom et nom requis";
  return { email, first_name, last_name, honorific };
}
