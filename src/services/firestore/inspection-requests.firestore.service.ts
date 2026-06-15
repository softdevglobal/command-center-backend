import admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import { randomInt } from "node:crypto";

import { getFirebaseBlueApp } from "../../db/firebase/firebase.blue.js";
import type {
  InspectionRequestCreateInput,
  InspectionRequestListOptions,
  InspectionRequestListResult,
  InspectionRequestRecord,
} from "../../types/inspection-request.types.js";

const COLLECTION = "requests";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ORDER_FIELD = "createdAt";
const REQUEST_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function tradeFirestore(): Firestore {
  const app = getFirebaseBlueApp();
  if (!app) {
    throw new Error(
      "Firebase Blue (bmspro-trade) Admin SDK is not available. Set FIREBASE_BLUE_* env vars with a valid service account key."
    );
  }
  return app.firestore();
}

function normalizePagination(options: InspectionRequestListOptions): {
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
): InspectionRequestRecord {
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

function statusError(message: string, statusCode = 400): Error {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(
  input: Record<string, unknown>,
  field: string
): Record<string, unknown> {
  const value = input[field];
  if (!isRecord(value)) {
    throw statusError(`${field} must be an object.`);
  }
  return value;
}

function requiredString(
  input: Record<string, unknown>,
  field: string,
  label = field
): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    throw statusError(`${label} is required.`);
  }
  return value.trim();
}

function optionalString(
  input: Record<string, unknown>,
  field: string,
  fallback: string
): string {
  const value = input[field];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !value.trim()) {
    throw statusError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredNumber(input: Record<string, unknown>, field: string): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw statusError(`${field} must be a number.`);
  }
  return value;
}

function optionalArray(
  input: Record<string, unknown>,
  field: string
): unknown[] {
  const value = input[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw statusError(`${field} must be an array.`);
  }
  return value;
}

function requiredArray(
  input: Record<string, unknown>,
  field: string
): unknown[] {
  const value = input[field];
  if (!Array.isArray(value)) {
    throw statusError(`${field} must be an array.`);
  }
  return value;
}

function normalizePreferredSlots(slots: unknown[]): Record<string, unknown>[] {
  return slots.map((slot, index) => {
    if (!isRecord(slot)) {
      throw statusError(`preferredSlots[${index}] must be an object.`);
    }
    return {
      date: requiredString(slot, "date", `preferredSlots[${index}].date`),
      timeRange: requiredString(
        slot,
        "timeRange",
        `preferredSlots[${index}].timeRange`
      ),
    };
  });
}

function generateRequestCode(): string {
  let suffix = "";
  for (let i = 0; i < 9; i += 1) {
    suffix += REQUEST_CODE_ALPHABET[randomInt(REQUEST_CODE_ALPHABET.length)];
  }
  return `INS-REQ ${suffix}`;
}

function normalizeCreatePayload(
  input: InspectionRequestCreateInput,
  id: string,
  now: Date
): FirebaseFirestore.DocumentData {
  const address = requiredRecord(input, "address");
  const customer = requiredRecord(input, "customer");

  return {
    address: {
      postcode: requiredString(address, "postcode", "address.postcode"),
      state: requiredString(address, "state", "address.state"),
      street: requiredString(address, "street", "address.street"),
      suburb: requiredString(address, "suburb", "address.suburb"),
    },
    assignedTo: input.assignedTo ?? null,
    budgetAud: requiredNumber(input, "budgetAud"),
    businessId: requiredString(input, "businessId"),
    createdAt: now,
    createdSource: optionalString(input, "createdSource", "booking_engine"),
    customRequest: input.customRequest ?? null,
    customer: {
      email: requiredString(customer, "email", "customer.email"),
      fullName: requiredString(customer, "fullName", "customer.fullName"),
      phone: requiredString(customer, "phone", "customer.phone"),
    },
    customerId: requiredString(input, "customerId"),
    customerNotes:
      typeof input.customerNotes === "string" ? input.customerNotes : null,
    id,
    ownerNote: input.ownerNote ?? null,
    ownerProposedSlots: optionalArray(input, "ownerProposedSlots"),
    preferredSlots: normalizePreferredSlots(
      requiredArray(input, "preferredSlots")
    ),
    requestCode: optionalString(input, "requestCode", generateRequestCode()),
    requestType: optionalString(input, "requestType", "existing_service"),
    scheduledEndTime: input.scheduledEndTime ?? null,
    scheduledSlot: input.scheduledSlot ?? null,
    scheduledStartTime: input.scheduledStartTime ?? null,
    serviceBusinessType: requiredString(input, "serviceBusinessType"),
    serviceId: requiredString(input, "serviceId"),
    serviceName: requiredString(input, "serviceName"),
    status: optionalString(input, "status", "pending"),
    updatedAt: now,
  };
}

export async function listInspectionRequestsInFirestore(
  options: InspectionRequestListOptions = {}
): Promise<InspectionRequestListResult> {
  const db = tradeFirestore();
  const { limit, offset } = normalizePagination(options);
  const base = db.collection(COLLECTION);

  let listQuery = base.orderBy(ORDER_FIELD, "desc");
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

export async function listInspectionRequestsByBusinessIdInFirestore(
  businessId: string,
  options: InspectionRequestListOptions = {}
): Promise<InspectionRequestListResult> {
  const key = businessId.trim();
  if (!key) {
    throw statusError("Business id is required.");
  }

  const db = tradeFirestore();
  const { limit, offset } = normalizePagination(options);
  const base = db.collection(COLLECTION).where("businessId", "==", key);

  let listQuery = base.orderBy(ORDER_FIELD, "desc");
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

export async function createInspectionRequestInFirestore(
  input: InspectionRequestCreateInput
): Promise<InspectionRequestRecord> {
  const db = tradeFirestore();
  const ref = db.collection(COLLECTION).doc();
  const now = new Date();
  const payload = normalizeCreatePayload(input, ref.id, now);

  await ref.create(payload);

  const snap = await ref.get();
  return docToRecord(snap.id, snap.data() ?? payload);
}

export async function getInspectionRequestByIdInFirestore(
  id: string
): Promise<InspectionRequestRecord | null> {
  const key = id.trim();
  if (!key) return null;

  const snap = await tradeFirestore().collection(COLLECTION).doc(key).get();
  if (!snap.exists) return null;
  return docToRecord(snap.id, snap.data() ?? {});
}
