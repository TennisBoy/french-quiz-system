import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { HttpError } from "./http.ts";

/** Service-role client: bypasses RLS. Only ever used inside Edge Functions. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Caller {
  admin: SupabaseClient;
  userId: string;
}

/** Verifies the caller's JWT. Authorization is checked per resource with the helpers below. */
export async function requireUser(req: Request): Promise<Caller> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Non authentifié");

  const admin = adminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new HttpError(401, "Session invalide");
  return { admin, userId: user.id };
}

export interface School {
  id: string;
  student_email_domain: string;
  staff_email_domain: string;
}

async function memberRole(caller: Caller, schoolId: string): Promise<string | null> {
  const { data, error } = await caller.admin.from("school_members").select("role")
    .eq("school_id", schoolId).eq("user_id", caller.userId).maybeSingle();
  if (error) throw error;
  return data?.role ?? null;
}

async function loadSchool(caller: Caller, schoolId: string): Promise<School> {
  const { data, error } = await caller.admin.from("schools")
    .select("id, student_email_domain, staff_email_domain").eq("id", schoolId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "École introuvable");
  return data;
}

/** The caller teaches the class, or administers its school. Returns the class's school. */
export async function requireClassTeacher(caller: Caller, classId: string): Promise<School> {
  const { data: cls, error } = await caller.admin.from("classes").select("school_id").eq("id", classId).maybeSingle();
  if (error) throw error;
  if (!cls) throw new HttpError(404, "Classe introuvable");

  const { data: teaches } = await caller.admin.from("class_teachers").select("class_id")
    .eq("class_id", classId).eq("teacher_id", caller.userId).maybeSingle();
  if (!teaches && (await memberRole(caller, cls.school_id)) !== "admin") {
    throw new HttpError(403, "Réservé aux enseignants de la classe");
  }
  return loadSchool(caller, cls.school_id);
}

/** The caller is an admin of the school. */
export async function requireSchoolAdmin(caller: Caller, schoolId: string): Promise<School> {
  if ((await memberRole(caller, schoolId)) !== "admin") throw new HttpError(403, "Réservé à l'administration de l'école");
  return loadSchool(caller, schoolId);
}

async function teachesStudent(caller: Caller, studentId: string): Promise<boolean> {
  const { data: enrolled, error } = await caller.admin.from("enrollments").select("class_id").eq("student_id", studentId);
  if (error) throw error;
  const classIds = (enrolled ?? []).map((e) => e.class_id);
  if (!classIds.length) return false;
  const { count, error: e2 } = await caller.admin.from("class_teachers").select("class_id", { count: "exact", head: true })
    .eq("teacher_id", caller.userId).in("class_id", classIds);
  if (e2) throw e2;
  return (count ?? 0) > 0;
}

/**
 * The caller may reset this person's password: a student enrolled in a class the caller teaches
 * (or in a school the caller administers), or a teacher of a school the caller administers.
 */
export async function requireCanManageUser(caller: Caller, userId: string): Promise<void> {
  if (userId === caller.userId) throw new HttpError(400, "Utilisez « Mot de passe » pour changer le vôtre");

  const { data: memberships, error } = await caller.admin.from("school_members").select("school_id, role").eq("user_id", userId);
  if (error) throw error;
  for (const m of memberships ?? []) {
    const callerRole = await memberRole(caller, m.school_id);
    if (callerRole === "admin" && m.role !== "admin") return;
    if (callerRole === "teacher" && m.role === "student" && (await teachesStudent(caller, userId))) return;
  }
  throw new HttpError(404, "Compte introuvable");
}
