import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { HttpError } from "./http.ts";

/** Service-role client: bypasses RLS. Only ever used inside Edge Functions. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Verifies the caller's JWT and that their profile is the teacher. Returns an admin client. */
export async function requireTeacher(req: Request): Promise<SupabaseClient> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Non authentifié");

  const admin = adminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new HttpError(401, "Session invalide");

  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "teacher") throw new HttpError(403, "Réservé à l'enseignant");

  return admin;
}
