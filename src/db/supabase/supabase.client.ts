import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

function trimEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const t = value.trim();
  return t === "" ? undefined : t;
}

function isUnset(value: string | undefined): boolean {
  const v = trimEnv(value);
  return (
    v === undefined ||
    v.startsWith("your_")
  );
}

function resolveSupabaseUrl(): string | undefined {
  const primary = process.env.SUPABASE_URL;
  if (!isUnset(primary)) return primary;
  const vite = process.env.VITE_SUPABASE_URL;
  if (!isUnset(vite)) return vite;
  return undefined;
}

function resolveSupabaseKey(): string | undefined {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isUnset(service)) return service;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!isUnset(anon)) return anon;
  const viteAnon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!isUnset(viteAnon)) return viteAnon;
  const vitePub = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!isUnset(vitePub)) return vitePub;
  return undefined;
}

/** Public Supabase API URL (with or without trailing slash normalized by callers). */
export function getSupabaseProjectUrl(): string | null {
  const url = resolveSupabaseUrl();
  return url ?? null;
}

/**
 * Anon / publishable key for calling Edge Functions with the caller's JWT
 * (`apikey` header). Prefer this over the service role for `create-agent`.
 */
export function getSupabaseAnonKeyForEdge(): string | null {
  const primary = process.env.SUPABASE_ANON_KEY;
  if (!isUnset(primary)) return primary as string;
  const viteAnon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!isUnset(viteAnon)) return viteAnon as string;
  const vitePub = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!isUnset(vitePub)) return vitePub as string;
  return null;
}

/** Required for server-side auth.admin and privileged inserts (agent registration). */
export function getSupabaseServiceRoleKey(): string | null {
  const k = trimEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!isUnset(k)) return k as string;
  return null;
}

/** Which Supabase env vars are missing for agent registration (URL + service role). */
export function getMissingSupabaseRegistrationEnv(): string[] {
  const missing: string[] = [];
  if (!getSupabaseProjectUrl()) missing.push("SUPABASE_URL");
  if (!getSupabaseServiceRoleKey()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

/** URL and key used by the client (for health checks without exposing keys in responses). */
export function getSupabaseConnectionInfo(): {
  url: string;
  key: string;
} | null {
  const url = resolveSupabaseUrl();
  const key = resolveSupabaseKey();
  if (!url || !key) return null;
  return { url, key };
}

/** Returns null when URL or key is missing or still a placeholder. */
export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = resolveSupabaseUrl();
  const key = resolveSupabaseKey();
  if (!url || !key) {
    cached = null;
    return null;
  }

  cached = createClient(url, key);
  return cached;
}
