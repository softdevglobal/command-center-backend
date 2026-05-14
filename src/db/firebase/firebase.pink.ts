import admin from "firebase-admin";

import { resolveFirebaseServiceAccount } from "./firebase.helpers.js";

let cached: admin.app.App | null | undefined;

/** bmspro-pink — connectivity only; agents are not written here. */
export function getFirebasePinkApp(): admin.app.App | null {
  if (cached !== undefined) return cached;

  const sa = resolveFirebaseServiceAccount("PINK");
  if (!sa) {
    cached = null;
    return null;
  }

  try {
    try {
      cached = admin.app("pink");
      return cached;
    } catch {
      cached = admin.initializeApp(
        { credential: admin.credential.cert(sa) },
        "pink"
      );
      return cached;
    }
  } catch {
    cached = null;
    return null;
  }
}
