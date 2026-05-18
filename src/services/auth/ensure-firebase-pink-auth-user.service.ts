import admin from "firebase-admin";

import { getFirebasePinkApp } from "../../db/firebase/firebase.pink.js";

/**
 * Ensures a Firebase Auth user exists in **bmspro-pink** with this email/password
 * (same pattern as BMS Black agent registration). Required for Command Center
 * `POST /api/auth/login` → `firebasePinkIdentityToolkit.idToken`.
 */
export async function ensureFirebasePinkAuthUser(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<string> {
  const app = getFirebasePinkApp();
  if (!app) {
    throw new Error(
      "Firebase Pink Admin is not configured on Command Center. Set FIREBASE_PINK_SERVICE_ACCOUNT or FIREBASE_PINK_PROJECT_ID + FIREBASE_PINK_CLIENT_EMAIL + FIREBASE_PINK_PRIVATE_KEY."
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
      throw new Error(`Firebase Pink: failed to resolve user: ${msg}`);
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
    throw new Error(`Firebase Pink: failed to create user: ${msg}`);
  }
}
