// POST { user_id } → { email, temp_password }
// Sets a new temporary password and forces a change at next login. Allowed for a teacher of one of
// the student's classes, or an admin of the person's school (see requireCanManageUser).
import { HttpError, json, serve } from "../_shared/http.ts";
import { requireCanManageUser, requireUser } from "../_shared/auth.ts";
import { generateTempPassword } from "../_shared/password.ts";

serve(async (req) => {
  const caller = await requireUser(req);
  const body = await req.json().catch(() => null);
  const userId = body?.user_id;
  if (typeof userId !== "string") throw new HttpError(400, "user_id requis");
  await requireCanManageUser(caller, userId);

  const { data: profile } = await caller.admin.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (!profile) throw new HttpError(404, "Compte introuvable");

  const temp_password = generateTempPassword();
  const { error } = await caller.admin.auth.admin.updateUserById(userId, { password: temp_password });
  if (error) throw error;

  // Must run after the password update: the on_auth_user_password_changed trigger clears the flag.
  const { error: flagError } = await caller.admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
  if (flagError) throw flagError;

  return json(req, { email: profile.email, temp_password });
});
