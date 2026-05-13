import admin from "firebase-admin";

import {
  parsePrivateKey,
  parseServiceAccountJson,
} from "./firebase.helpers.js";

const APP_NAME = "bmspro-blue";

function resolveBlueServiceAccount(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} | null {
  const fromJson = parseServiceAccountJson(
    process.env.FIREBASE_BLUE_SERVICE_ACCOUNT
  );
  if (fromJson) return fromJson;

  const b64 = process.env.FIREBASE_BLUE_SERVICE_ACCOUNT_BASE64?.trim();
  if (b64) {
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      const fromDecoded = parseServiceAccountJson(decoded);
      if (fromDecoded) return fromDecoded;
    } catch {
      /* ignore */
    }
  }

  const projectId = process.env.FIREBASE_BLUE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_BLUE_CLIENT_EMAIL;
  const privateKey = parsePrivateKey(process.env.FIREBASE_BLUE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) return null;

  return { projectId, clientEmail, privateKey };
}

/** Firebase Admin for project bmspro-blue (service account env vars). */
export function getFirebaseBlueApp(): admin.app.App | null {
  if (admin.apps.some((a) => a?.name === APP_NAME)) {
    return admin.app(APP_NAME);
  }

  const cred = resolveBlueServiceAccount();
  if (!cred) return null;

  return admin.initializeApp(
    {
      credential: admin.credential.cert({
        projectId: cred.projectId,
        clientEmail: cred.clientEmail,
        privateKey: cred.privateKey,
      }),
    },
    APP_NAME
  );
}
