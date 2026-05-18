/**
 * Firebase **bmspro-pink** email/password session via Identity Toolkit REST.
 */

import {
  signInWithPasswordIdentityToolkit,
  type IdentityToolkitPasswordResponse,
} from "./firebase-identity-toolkit-password.service.js";

export type FirebasePinkLoginTokenResponse = IdentityToolkitPasswordResponse;

/**
 * Identity Toolkit `accounts:signInWithPassword` for the Pink Firebase project
 * (Web API key = `FIREBASE_PINK_WEB_API_KEY`).
 */
export async function signInFirebasePinkWithPassword(input: {
  email: string;
  password: string;
  webApiKey: string;
}): Promise<
  | { ok: true; data: FirebasePinkLoginTokenResponse }
  | { ok: false; message: string; status?: number }
> {
  return signInWithPasswordIdentityToolkit(input);
}
