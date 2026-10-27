import type { Firestore } from "firebase-admin/firestore";

import { getFirebasePinkApp } from "../../db/firebase/firebase.pink.js";
import type {
  BlackBookingRecord,
  BlackBookingsByPhoneOptions,
} from "../../types/bms-black-booking.types.js";
import { findBookingsByPhoneInDb } from "./black-bookings.firestore.service.js";

function pinkFirestore(): Firestore {
  const app = getFirebasePinkApp();
  if (!app) {
    throw new Error(
      "Firebase Pink (bmspro-pink) Admin SDK is not available. Set FIREBASE_PINK_* env vars with a valid service account key."
    );
  }
  return app.firestore();
}

/**
 * Queries root `bookings` on bmspro-pink by phone variants (clientPhone / customerPhone /
 * phone / contactNumber). Optional ownerUid filtered in memory. Most recent first, max 200.
 */
export async function findPinkBookingsByPhoneInFirestore(
  options: BlackBookingsByPhoneOptions
): Promise<BlackBookingRecord[]> {
  return findBookingsByPhoneInDb(pinkFirestore(), options);
}
