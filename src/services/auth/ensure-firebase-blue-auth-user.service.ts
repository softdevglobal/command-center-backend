import admin from "firebase-admin";

import { getFirebaseBlueApp } from "../../db/firebase/firebase.blue.js";

/**
 * Ensures a Firebase Auth user exists in **bmspro-trade** (Blue / trade Admin SDK).
 *
 * Used by:
 *   • `registerAgentOnCommandCenter` — agent register (`POST /api/agents/register`)
 *   • `provisionCallCenterLeadFirebaseIdentities` — super admin bootstrap (`POST /api/super-admin/register`)
 *
 * Requires `FIREBASE_BLUE_PROJECT_ID`, `FIREBASE_BLUE_CLIENT_EMAIL`, `FIREBASE_BLUE_PRIVATE_KEY`
 * (or `FIREBASE_BLUE_SERVICE_ACCOUNT` JSON) in server `.env`.
 */
export async function ensureFirebaseBlueAuthUser(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<string> {
  const app = getFirebaseBlueApp();
  if (!app) {
    throw new Error(
      "Firebase Blue Admin is not configured on Command Center. Set FIREBASE_BLUE_SERVICE_ACCOUNT or FIREBASE_BLUE_PROJECT_ID + FIREBASE_BLUE_CLIENT_EMAIL + FIREBASE_BLUE_PRIVATE_KEY."
    );
  }

  const auth = admin.auth(app);
  const email = input.email.trim().toLowerCase();

  try {
    const existing = await auth.getUserByEmail(email);
    try {
      const dn =
        input.displayName || existing.displayName || undefined;
      await auth.updateUser(existing.uid, {
        ...(dn !== undefined ? { displayName: dn } : {}),
        disabled: false,
        password: input.password,
      });
    } catch {
      // best-effort sync
    }
    return existing.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      const msg = err instanceof Error ? err.message : "Firebase lookup failed";
      throw new Error(`Firebase Blue: failed to resolve user: ${msg}`);
    }
  }

  try {
    const created = await auth.createUser({
      email,
      password: input.password,
      displayName: input.displayName,
      emailVerified: false,
      disabled: false,
    });
    return created.uid;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Firebase create failed";
    throw new Error(`Firebase Blue: failed to create user: ${msg}`);
  }
}
