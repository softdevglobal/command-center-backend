import admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";

import { getFirebaseBlueApp } from "../../db/firebase/firebase.blue.js";
import type {
  BusinessListOptions,
  BusinessListResult,
  BusinessRecord,
} from "../../types/business.types.js";

const COLLECTION = "businesses";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function tradeFirestore(): Firestore {
  const app = getFirebaseBlueApp();
  if (!app) {
    throw new Error(
      "Firebase Blue (bmspro-trade) Admin SDK is not available. Set FIREBASE_BLUE_* env vars with a valid service account key."
    );
  }
  return app.firestore();
}

function normalizePagination(options: BusinessListOptions): {
  limit: number;
  offset: number;
} {
  const limitRaw = options.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT)
  );
  const offsetRaw = options.offset ?? 0;
  const offset = Math.max(
    0,
    Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0
  );
  return { limit, offset };
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
): BusinessRecord {
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

export async function listBusinessesInFirestore(
  options: BusinessListOptions = {}
): Promise<BusinessListResult> {
  const db = tradeFirestore();
  const { limit, offset } = normalizePagination(options);
  const base = db.collection(COLLECTION);

  let listQuery = base.orderBy(admin.firestore.FieldPath.documentId());
  if (offset > 0) listQuery = listQuery.offset(offset);
  listQuery = listQuery.limit(limit);

  const [snapshot, countSnap] = await Promise.all([
    listQuery.get(),
    base.count().get(),
  ]);

  return {
    data: snapshot.docs.map((d) => docToRecord(d.id, d.data())),
    total: countSnap.data().count,
    limit,
    offset,
  };
}

export async function getBusinessByIdInFirestore(
  id: string
): Promise<BusinessRecord | null> {
  const key = id.trim();
  if (!key) return null;

  const snap = await tradeFirestore().collection(COLLECTION).doc(key).get();
  if (!snap.exists) return null;
  return docToRecord(snap.id, snap.data() ?? {});
}
