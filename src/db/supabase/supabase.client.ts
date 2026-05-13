import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

function isUnset(value: string | undefined): boolean {
  return (
    value === undefined ||
    value === "" ||
    value.startsWith("your_")
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
