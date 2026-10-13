import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { Me, Membership } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
/** False when the build ran without the Vite env vars; main.ts then shows a config message instead of the app. */
export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient<Database>(url || "http://localhost.invalid", anonKey || "missing");

let cachedMe: Me | null = null;

/** The signed-in user's profile and school memberships (my_context RPC), cached until sign-out. */
export async function currentMe(force = false): Promise<Me | null> {
  if (cachedMe && !force) return cachedMe;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return (cachedMe = null);
  const { data, error } = await supabase.rpc("my_context");
  if (error) throw error;
  return (cachedMe = (data as unknown as Me | null) ?? null);
}

export function clearMe() {
  cachedMe = null;
}

/** Teachers and admins use the teacher pages; everyone else is a student. */
export function isStaff(me: Me): boolean {
  return me.memberships.some((m) => m.role !== "student");
}

/** Schools where the user is staff (they can create classes and assignments there). */
export function staffSchools(me: Me): Membership[] {
  return me.memberships.filter((m) => m.role !== "student");
}

export function adminSchools(me: Me): Membership[] {
  return me.memberships.filter((m) => m.role === "admin");
}

/** Calls an Edge Function and turns its `{ error }` body into a thrown Error. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const res = await supabase.functions.invoke<T>(name, { body });
  const error: unknown = res.error; // typed `any` by supabase-js
  if (error) {
    let message = errorMessage(error);
    try {
      const context: unknown = (error as { context?: unknown }).context;
      const payload: unknown = context instanceof Response ? await context.json() : null;
      if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") message = payload.error;
    } catch {
      // body was not JSON; keep the generic message
    }
    throw new Error(message);
  }
  return res.data!;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return String(e);
}
