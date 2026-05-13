import { getFirebaseBlackApp } from "./firebase/firebase.black.js";
import { getFirebaseBlueApp } from "./firebase/firebase.blue.js";
import { getFirebasePinkApp } from "./firebase/firebase.pink.js";
import {
  getSupabaseClient,
  getSupabaseConnectionInfo,
} from "./supabase/supabase.client.js";

function padLabel(label: string, width: number): string {
  return label.length >= width ? label : label + " ".repeat(width - label.length);
}

async function checkSupabase(): Promise<string> {
  const client = getSupabaseClient();
  if (!client) {
    return `${padLabel("Supabase", 18)} not configured (set SUPABASE_URL + key or VITE_SUPABASE_*)`;
  }
  const info = getSupabaseConnectionInfo();
  if (!info) {
    return `${padLabel("Supabase", 18)} missing URL or key`;
  }
  try {
    const healthUrl = `${info.url.replace(/\/$/, "")}/auth/v1/health`;
    const r = await fetch(healthUrl, {
      headers: {
        apikey: info.key,
        Authorization: `Bearer ${info.key}`,
      },
    });
    if (r.ok) {
      return `${padLabel("Supabase", 18)} OK (Auth reachable)`;
    }
    return `${padLabel("Supabase", 18)} FAIL (HTTP ${r.status})`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return `${padLabel("Supabase", 18)} FAIL (${msg})`;
  }
}

type NamedFirebaseApp = NonNullable<ReturnType<typeof getFirebaseBlackApp>>;

async function checkFirebase(
  label: string,
  getApp: () => NamedFirebaseApp | null
): Promise<string> {
  const app = getApp();
  if (!app) {
    return `${padLabel(label, 18)} not configured`;
  }
  try {
    await app.firestore().listCollections();
    return `${padLabel(label, 18)} OK (Firestore)`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return `${padLabel(label, 18)} FAIL (${msg})`;
  }
}

/** Logs database connectivity after env is loaded (run before listen). */
export async function printStartupDatabaseStatus(port: number): Promise<void> {
  const lines = await Promise.all([
    checkSupabase(),
    checkFirebase("Firebase (black)", getFirebaseBlackApp),
    checkFirebase("Firebase (pink)", getFirebasePinkApp),
    checkFirebase("Firebase (blue)", getFirebaseBlueApp),
  ]);

  console.log("");
  console.log("============================================================");
  console.log(`  Command Center Backend  |  port ${port}`);
  console.log("------------------------------------------------------------");
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  console.log("============================================================");
  console.log("");
}
