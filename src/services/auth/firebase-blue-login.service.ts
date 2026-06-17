/**
 * Firebase **bmspro-trade** (Blue) email/password session via Identity Toolkit REST.
 */

import {
  signInWithPasswordIdentityToolkit,
  type IdentityToolkitPasswordResponse,
} from "./firebase-identity-toolkit-password.service.js";

export type FirebaseBlueLoginTokenResponse = IdentityToolkitPasswordResponse;

/**
 * Identity Toolkit `accounts:signInWithPassword` for the Blue Firebase project
 * (Web API key = `FIREBASE_BLUE_WEB_API_KEY`).
 */
export async function signInFirebaseBlueWithPassword(input: {
  email: string;
  password: string;
  webApiKey: string;
}): Promise<
  | { ok: true; data: FirebaseBlueLoginTokenResponse }
  | { ok: false; message: string; status?: number }
> {
  return signInWithPasswordIdentityToolkit(input);
}
