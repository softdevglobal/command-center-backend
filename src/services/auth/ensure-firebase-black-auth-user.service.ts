import admin from "firebase-admin";

import { getFirebaseBlackApp } from "../../db/firebase/firebase.black.js";

/**
 * Ensures a Firebase Auth user exists in **bmspro-black** (Admin SDK).
 * Same behaviour as BMS Black adminpanel agent registration.
 */
export async function ensureFirebaseBlackAuthUser(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<string> {
  const app = getFirebaseBlackApp();
  if (!app) {
    throw new Error(
      "Firebase Black Admin is not configured on Command Center. Set FIREBASE_BLACK_SERVICE_ACCOUNT or FIREBASE_BLACK_PROJECT_ID + FIREBASE_BLACK_CLIENT_EMAIL + FIREBASE_BLACK_PRIVATE_KEY."
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
      // best-effort
    }
    return existing.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      const msg = err instanceof Error ? err.message : "Firebase lookup failed";
      throw new Error(`Firebase Black: failed to resolve user: ${msg}`);
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
    throw new Error(`Firebase Black: failed to create user: ${msg}`);
  }
}
