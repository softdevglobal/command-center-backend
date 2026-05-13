import type { ServiceAccount } from "firebase-admin/app";

function normalizePrivateKey(key: string): string {
  return key.replace(/\\n/g, "\n");
}

function fromSeparatedEnv(prefix: "BLACK" | "PINK" | "BLUE"): ServiceAccount | null {
  const projectId = process.env[`FIREBASE_${prefix}_PROJECT_ID`]?.trim();
  const clientEmail = process.env[`FIREBASE_${prefix}_CLIENT_EMAIL`]?.trim();
  const privateKeyRaw = process.env[`FIREBASE_${prefix}_PRIVATE_KEY`]?.trim();
  if (!projectId || !clientEmail || !privateKeyRaw) return null;
  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKeyRaw),
  };
}

function serviceAccountFromJson(raw: string): ServiceAccount | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const projectId = String(j.project_id ?? "");
    const clientEmail = String(j.client_email ?? "");
    const privateKey = normalizePrivateKey(String(j.private_key ?? ""));
    if (!projectId || !clientEmail || !privateKey) return null;
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

/** Resolve credentials for connectivity checks (Firestore ping). Not used for saving agents. */
export function resolveFirebaseServiceAccount(
  prefix: "BLACK" | "PINK" | "BLUE"
): ServiceAccount | null {
  const jsonEnvByPrefix: Record<typeof prefix, string[]> = {
    BLACK: ["FIREBASE_BLACK_SERVICE_ACCOUNT", "FIREBASE_SERVICE_ACCOUNT"],
    PINK: ["FIREBASE_PINK_SERVICE_ACCOUNT"],
    BLUE: ["FIREBASE_BLUE_SERVICE_ACCOUNT"],
  };
  for (const envName of jsonEnvByPrefix[prefix]) {
    const raw = process.env[envName]?.trim();
    if (raw) {
      const sa = serviceAccountFromJson(raw);
      if (sa) return sa;
    }
  }
  return fromSeparatedEnv(prefix);
}
