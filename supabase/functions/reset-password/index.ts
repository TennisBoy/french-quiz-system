// POST { student_id } → { email, temp_password }
// Teacher only. Sets a new temporary password and forces a change at next login.
import { HttpError, json, serve } from "../_shared/http.ts";
import { requireTeacher } from "../_shared/auth.ts";
import { generateTempPassword } from "../_shared/password.ts";

serve(async (req) => {
  const admin = await requireTeacher(req);
  const body = await req.json().catch(() => null);
  const studentId = body?.student_id;
  if (typeof studentId !== "string") throw new HttpError(400, "student_id requis");

  const { data: profile } = await admin.from("profiles").select("email, role").eq("id", studentId).maybeSingle();
  if (!profile || profile.role !== "student") throw new HttpError(404, "Élève introuvable");

  const temp_password = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(studentId, { password: temp_password });
  if (error) throw error;

  // Must run after the password update: the on_auth_user_password_changed trigger clears the flag.
  const { error: flagError } = await admin.from("profiles").update({ must_change_password: true }).eq("id", studentId);
  if (flagError) throw flagError;

  return json(req, { email: profile.email, temp_password });
});
