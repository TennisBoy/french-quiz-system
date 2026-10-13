// POST { role: "student", class_id, accounts: [{ email, first_name, last_name }] }
//    | { role: "teacher", school_id, accounts: [{ email, first_name, last_name, honorific? }] }
// → { results: [{ email, status: "created" | "enrolled" | "exists" | "invalid" | "error", temp_password?, message? }] }
//
// Students: the caller must teach the class (or administer its school). New accounts join the
// school as students and are enrolled in the class; an existing student of the same school is just
// enrolled. Teachers: the caller must administer the school. Emails must use the school's domain.
// New accounts get a temporary password they must change on first login.
import { HttpError, json, serve } from "../_shared/http.ts";
import { type Caller, requireClassTeacher, requireSchoolAdmin, requireUser, type School } from "../_shared/auth.ts";
import { generateTempPassword } from "../_shared/password.ts";
import { type AccountInput, validateAccount } from "../_shared/accounts.ts";

const MAX_ACCOUNTS = 200;

interface Target {
  role: "student" | "teacher";
  school: School;
  classId: string | null;
}

serve(async (req) => {
  const caller = await requireUser(req);
  const body = await req.json().catch(() => null);
  const rows: unknown[] = Array.isArray(body?.accounts) ? body.accounts : [];
  if (rows.length === 0 || rows.length > MAX_ACCOUNTS) {
    throw new HttpError(400, `Entre 1 et ${MAX_ACCOUNTS} comptes par envoi`);
  }

  let target: Target;
  if (body?.role === "student" && typeof body.class_id === "string") {
    target = { role: "student", school: await requireClassTeacher(caller, body.class_id), classId: body.class_id };
  } else if (body?.role === "teacher" && typeof body.school_id === "string") {
    target = { role: "teacher", school: await requireSchoolAdmin(caller, body.school_id), classId: null };
  } else {
    throw new HttpError(400, "role et class_id (élèves) ou school_id (enseignants) requis");
  }
  const domain = target.role === "student" ? target.school.student_email_domain : target.school.staff_email_domain;

  const results = [];
  for (const raw of rows) {
    const account = validateAccount(raw, domain);
    if (typeof account === "string") {
      const email = String((raw as { email?: unknown } | null)?.email ?? "");
      results.push({ email, status: "invalid", message: account });
      continue;
    }
    try {
      results.push(await createOrEnroll(caller, target, account));
    } catch (e) {
      console.error(account.email, e);
      results.push({ email: account.email, status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  return json(req, { results });
});

async function createOrEnroll(caller: Caller, target: Target, account: AccountInput) {
  const { admin } = caller;
  const { data: existing, error: lookupError } = await admin.from("profiles").select("id").eq("email", account.email).maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    const { data: member } = await admin.from("school_members").select("role")
      .eq("school_id", target.school.id).eq("user_id", existing.id).maybeSingle();
    if (target.role === "student" && member?.role === "student") {
      const { error } = await admin.from("enrollments")
        .upsert({ class_id: target.classId, student_id: existing.id }, { ignoreDuplicates: true });
      if (error) throw error;
      return { email: account.email, status: "enrolled", message: "Compte existant, ajouté à la classe" };
    }
    return {
      email: account.email,
      status: "exists",
      message: member ? "Compte déjà existant dans cette école" : "Compte existant dans une autre école",
    };
  }

  const temp_password = generateTempPassword();
  const { data, error } = await admin.auth.admin.createUser({ email: account.email, password: temp_password, email_confirm: true });
  if (error) throw error;
  const userId = data.user.id;

  // The on_auth_user_created trigger made a bare profile. Fill it in and attach it to the school;
  // roll the whole account back if any step fails.
  try {
    const steps = [
      () => admin.from("profiles").update({
        first_name: account.first_name,
        last_name: account.last_name,
        honorific: account.honorific,
        must_change_password: true,
      }).eq("id", userId),
      () => admin.from("school_members").insert({ school_id: target.school.id, user_id: userId, role: target.role }),
      ...(target.classId ? [() => admin.from("enrollments").insert({ class_id: target.classId, student_id: userId })] : []),
    ];
    for (const step of steps) {
      const { error: stepError } = await step();
      if (stepError) throw stepError;
    }
  } catch (e) {
    await admin.auth.admin.deleteUser(userId);
    throw e;
  }
  return { email: account.email, status: "created", temp_password };
}
