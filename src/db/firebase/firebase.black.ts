import admin from "firebase-admin";

import { resolveFirebaseServiceAccount } from "./firebase.helpers.js";

let cached: admin.app.App | null | undefined;

/** bmspro-black — connectivity only; agents are not written here. */
export function getFirebaseBlackApp(): admin.app.App | null {
  if (cached !== undefined) return cached;

  const sa = resolveFirebaseServiceAccount("BLACK");
  if (!sa) {
    cached = null;
    return null;
  }

  try {
    try {
      cached = admin.app("black");
      return cached;
    } catch {
      cached = admin.initializeApp(
        { credential: admin.credential.cert(sa) },
        "black"
      );
      return cached;
    }
  } catch {
    cached = null;
    return null;
  }
}
