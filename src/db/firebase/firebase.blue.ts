import admin from "firebase-admin";

import { resolveFirebaseServiceAccount } from "./firebase.helpers.js";

let cached: admin.app.App | null | undefined;

/** bmspro-blue — optional connectivity check only. */
export function getFirebaseBlueApp(): admin.app.App | null {
  if (cached !== undefined) return cached;

  const sa = resolveFirebaseServiceAccount("BLUE");
  if (!sa) {
    cached = null;
    return null;
  }

  try {
    try {
      cached = admin.app("blue");
      return cached;
    } catch {
      cached = admin.initializeApp(
        { credential: admin.credential.cert(sa) },
        "blue"
      );
      return cached;
    }
  } catch {
    cached = null;
    return null;
  }
}
