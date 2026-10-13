import { createClient } from "@supabase/supabase-js";
import type { Profile } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
/** False when the build ran without the Vite env vars; main.ts then shows a config message instead of the app. */
export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || "http://localhost.invalid", anonKey || "missing");

let cachedProfile: Profile | null = null;

export async function currentProfile(force = false): Promise<Profile | null> {
  if (cachedProfile && !force) return cachedProfile;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return (cachedProfile = null);
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error) throw error;
  return (cachedProfile = data as Profile);
}

export function clearProfile() {
  cachedProfile = null;
}

/** Calls an Edge Function and turns its `{ error }` body into a thrown Error. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const payload = await (error as { context?: Response }).context?.json();
      if (payload?.error) message = payload.error;
    } catch {
      // body was not JSON; keep the generic message
    }
    throw new Error(message);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
