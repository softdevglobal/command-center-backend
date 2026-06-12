import admin from "firebase-admin";

import { getFirebaseBlackApp } from "../../db/firebase/firebase.black.js";
import { getFirebaseBlueApp } from "../../db/firebase/firebase.blue.js";
import { getFirebasePinkApp } from "../../db/firebase/firebase.pink.js";
import { ensureFirebaseBlackAuthUser } from "./ensure-firebase-black-auth-user.service.js";
import { ensureFirebaseBlueAuthUser } from "./ensure-firebase-blue-auth-user.service.js";
import { ensureFirebasePinkAuthUser } from "./ensure-firebase-pink-auth-user.service.js";

/**
 * Schema mirrors BMS Black/Pink "create super admin" flows exactly:
 * { uid, email, displayName, role: "super_admin", provider: "password", createdAt, updatedAt }
 */
async function upsertSuperAdminsDoc(
  app: admin.app.App,
  firebaseUid: string,
  email: string,
  displayName: string
): Promise<void> {
  const ref = admin.firestore(app).doc(`super_admins/${firebaseUid}`);
  const snap = await ref.get();
  const now = new Date();
  await ref.set(
    {
      uid: firebaseUid,
      email: email.trim().toLowerCase(),
      displayName: displayName.trim() || email.trim(),
      role: "super_admin",
      provider: "password",
      updatedAt: now,
      ...(snap.exists ? {} : { createdAt: now }),
    },
    { merge: true }
  );
}

export type ProvisionLeadFirebaseResult = {
  blackUid?: string;
  pinkUid?: string;
  blueUid?: string;
  warnings: string[];
};

/**
 * Ensures Firebase Auth users exist in BMS Black, Pink, and Blue (trade) **and**
 * `super_admins/{uid}` Firestore docs so BMS / trade admin UIs accept the account.
 *
 * Used for Command Center bootstrap (`POST /api/super-admin/register`) and any flow that mirrors
 * BMS “create super admin” without calling each platform’s HTTP API directly.
 */
export async function provisionCallCenterLeadFirebaseIdentities(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<ProvisionLeadFirebaseResult> {
  const warnings: string[] = [];
  const email = input.email.trim();
  const dn = input.displayName.trim() || email;

  let blackUid: string | undefined;
  const blackApp = getFirebaseBlackApp();
  if (!blackApp) {
    warnings.push("Firebase Black Admin SDK not configured — set FIREBASE_BLACK_* credentials.");
  } else {
    try {
      blackUid = await ensureFirebaseBlackAuthUser({
        email,
        password: input.password,
        displayName: dn,
      });
      await upsertSuperAdminsDoc(blackApp, blackUid, email, dn);
    } catch (e) {
      warnings.push(
        `Firebase Black provisioning failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  let pinkUid: string | undefined;
  const pinkApp = getFirebasePinkApp();
  if (!pinkApp) {
    warnings.push(
      "Firebase Pink Admin SDK not configured — set FIREBASE_PINK_* credentials (optional for Black-only)."
    );
  } else {
    try {
      pinkUid = await ensureFirebasePinkAuthUser({
        email,
        password: input.password,
        displayName: dn,
      });
      await upsertSuperAdminsDoc(pinkApp, pinkUid, email, dn);
    } catch (e) {
      warnings.push(
        `Firebase Pink provisioning failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  let blueUid: string | undefined;
  const blueApp = getFirebaseBlueApp();
  if (!blueApp) {
    warnings.push(
      "Firebase Blue Admin SDK not configured — set FIREBASE_BLUE_* credentials (bmspro-trade)."
    );
  } else {
    try {
      blueUid = await ensureFirebaseBlueAuthUser({
        email,
        password: input.password,
        displayName: dn,
      });
      await upsertSuperAdminsDoc(blueApp, blueUid, email, dn);
    } catch (e) {
      warnings.push(
        `Firebase Blue provisioning failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return {
    ...(blackUid !== undefined ? { blackUid } : {}),
    ...(pinkUid !== undefined ? { pinkUid } : {}),
    ...(blueUid !== undefined ? { blueUid } : {}),
    warnings,
  };
}