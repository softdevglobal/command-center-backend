import admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";

import { getFirebaseBlackApp } from "../../db/firebase/firebase.black.js";
import type {
  BlackBookingRecord,
  BlackBookingsByPhoneOptions,
} from "../../types/bms-black-booking.types.js";

const COLLECTION = "bookings";
const PHONE_FIELDS = [
  "clientPhone",
  "customerPhone",
  "phone",
  "contactNumber",
] as const;
const MAX_PHONE_VARIANTS = 30;
const MAX_RESULTS = 200;

function blackFirestore(): Firestore {
  const app = getFirebaseBlackApp();
  if (!app) {
    throw new Error(
      "Firebase Black (bmspro-black) Admin SDK is not available. Set FIREBASE_BLACK_* env vars (or FIREBASE_SERVICE_ACCOUNT) with a valid service account key."
    );
  }
  return app.firestore();
}

function serializeFirestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString();
  }
  if (value instanceof admin.firestore.GeoPoint) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (value instanceof admin.firestore.DocumentReference) {
    return value.path;
  }
  if (Array.isArray(value)) {
    return value.map(serializeFirestoreValue);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeFirestoreValue(v);
    }
    return out;
  }
  return value;
}

function docToRecord(
  id: string,
  data: FirebaseFirestore.DocumentData
): BlackBookingRecord {
  const serialized = serializeFirestoreValue(data);
  return {
    id,
    ...(typeof serialized === "object" &&
    serialized !== null &&
    !Array.isArray(serialized)
      ? (serialized as Record<string, unknown>)
      : {}),
  };
}

/** Sri Lankan phone variant expansion, capped at 30 entries (Firestore `in` limit). */
export function buildPhoneLookupVariants(rawInput: string): string[] {
  const raw = rawInput.trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return [];

  const variants = new Set<string>([digits, raw]);
  if (raw.startsWith("+")) variants.add(raw.slice(1));

  if (digits.startsWith("94") && digits.length === 11) {
    const local = digits.slice(2);
    variants.add(`0${local}`);
    variants.add(local);
    variants.add(`+94${local}`);
  }
  if (digits.startsWith("0") && digits.length === 10) {
    const local = digits.slice(1);
    variants.add(`94${local}`);
    variants.add(`+94${local}`);
    variants.add(local);
  }
  if (
    digits.length === 9 &&
    !digits.startsWith("0") &&
    !digits.startsWith("94")
  ) {
    variants.add(`0${digits}`);
    variants.add(`94${digits}`);
    variants.add(`+94${digits}`);
  }

  return Array.from(variants).slice(0, MAX_PHONE_VARIANTS);
}

function bookingDateKey(data: FirebaseFirestore.DocumentData): string {
  return String(data.date ?? data.bookingDate ?? "");
}

/**
 * Queries root `bookings` on bmspro-black by phone variants across known phone fields.
 * Optional ownerUid is applied in memory (no composite index). Most recent first, max 200.
 */
export async function findBlackBookingsByPhoneInFirestore(
  options: BlackBookingsByPhoneOptions
): Promise<BlackBookingRecord[]> {
  const variants = buildPhoneLookupVariants(options.phone);
  if (variants.length === 0) return [];

  const db = blackFirestore();
  const merged = new Map<string, FirebaseFirestore.DocumentData>();

  await Promise.all(
    PHONE_FIELDS.map(async (field) => {
      try {
        const snap = await db
          .collection(COLLECTION)
          .where(field, "in", variants)
          .get();
        for (const doc of snap.docs) {
          merged.set(doc.id, doc.data());
        }
      } catch {
        // Field may not exist or be indexed — skip silently.
      }
    })
  );

  let entries = Array.from(merged.entries());

  const ownerUid = options.ownerUid?.trim();
  if (ownerUid) {
    entries = entries.filter(
      ([, data]) =>
        String(data.ownerUid ?? data.tenantId ?? data.owner_uid ?? "") ===
        ownerUid
    );
  }

  entries.sort(([, a], [, b]) =>
    bookingDateKey(b).localeCompare(bookingDateKey(a))
  );

  return entries
    .slice(0, MAX_RESULTS)
    .map(([id, data]) => docToRecord(id, data));
}
