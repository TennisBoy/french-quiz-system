// POST { class_id, students: [{ email, first_name, last_name }] }
// → { results: [{ email, status: "created" | "exists" | "invalid" | "error", temp_password?, message? }] }
// Teacher only. Creates student accounts with a temporary password they must change on first login.
import { HttpError, json, serve } from "../_shared/http.ts";
import { requireTeacher } from "../_shared/auth.ts";
import { generateTempPassword } from "../_shared/password.ts";
import { validateStudent } from "../_shared/students.ts";

const MAX_STUDENTS = 200;

serve(async (req) => {
  const admin = await requireTeacher(req);
  const body = await req.json().catch(() => null);
  const classId = body?.class_id;
  const rows: unknown[] = Array.isArray(body?.students) ? body.students : [];

  if (typeof classId !== "string") throw new HttpError(400, "class_id requis");
  if (rows.length === 0 || rows.length > MAX_STUDENTS) {
    throw new HttpError(400, `Entre 1 et ${MAX_STUDENTS} élèves par envoi`);
  }
  const { data: cls } = await admin.from("classes").select("id").eq("id", classId).maybeSingle();
  if (!cls) throw new HttpError(400, "Classe introuvable");

  const results = [];
  for (const raw of rows) {
    const student = validateStudent(raw);
    if (typeof student === "string") {
      const email = String((raw as { email?: unknown } | null)?.email ?? "");
      results.push({ email, status: "invalid", message: student });
      continue;
    }

    const temp_password = generateTempPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email: student.email,
      password: temp_password,
      email_confirm: true,
    });

    if (error) {
      if (error.code === "email_exists" || /already/i.test(error.message)) {
        results.push({ email: student.email, status: "exists", message: "Compte déjà existant" });
      } else {
        console.error(student.email, error);
        results.push({ email: student.email, status: "error", message: error.message });
      }
      continue;
    }

    // The on_auth_user_created trigger made a bare profile; fill it in. Roll back the account on failure.
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        first_name: student.first_name,
        last_name: student.last_name,
        class_id: classId,
        must_change_password: true,
      })
      .eq("id", data.user.id);
    if (profileError) {
      console.error(student.email, profileError);
      await admin.auth.admin.deleteUser(data.user.id);
      results.push({ email: student.email, status: "error", message: profileError.message });
      continue;
    }

    results.push({ email: student.email, status: "created", temp_password });
  }

  return json(req, { results });
});
