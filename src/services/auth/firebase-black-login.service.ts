/**
 * Firebase **bmspro-black** email/password session via Identity Toolkit REST.
 * @see https://firebase.google.com/docs/reference/rest/auth
 */

import {
  signInWithPasswordIdentityToolkit,
  type IdentityToolkitPasswordResponse,
} from "./firebase-identity-toolkit-password.service.js";

/** @deprecated Prefer {@link IdentityToolkitPasswordResponse} from identity-toolkit service */
export type FirebaseBlackLoginTokenResponse = IdentityToolkitPasswordResponse;

/**
 * Identity Toolkit `accounts:signInWithPassword` for the Black Firebase project
 * (Web API key = `FIREBASE_BLACK_WEB_API_KEY`).
 */
export async function signInFirebaseBlackWithPassword(input: {
  email: string;
  password: string;
  webApiKey: string;
}): Promise<
  | { ok: true; data: FirebaseBlackLoginTokenResponse }
  | { ok: false; message: string; status?: number }
> {
  return signInWithPasswordIdentityToolkit(input);
}
