import admin from "firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "node:crypto";

import { getFirebaseBlackApp } from "../../db/firebase/firebase.black.js";

const DEFAULT_COLLECTION = "agent_activities";
const STORAGE_PREFIX = "call-center/agent-activities";

const TEXT_FIELDS = [
  "activityType",
  "callId",
  "agentName",
  "agentUserId",
  "callerNumber",
  "callerName",
  "agentNote",
  "note",
  "didNumber",
  "ownerId",
  "branchId",
  "branchName",
  "queueId",
  "queueName",
  "tenantId",
  "recordingFileName",
  "recordingMimeType",
  "recordingSizeBytes",
  "recordingUrl",
  "recordingCallId",
] as const;

export type SaveBlackAgentActivityInput = {
  fields: Record<string, unknown>;
  recording?: Express.Multer.File;
  authenticatedSupabaseUserId?: string;
};

export type SaveBlackAgentActivityResult = {
  id: string;
  collection: string;
  firestorePath: string;
  recordingUrl: string | null;
  recordingFileName: string | null;
};

function blackFirebase() {
  const app = getFirebaseBlackApp();
  if (!app) {
    throw new Error(
      "Firebase Black (bmspro-black) Admin SDK is not available. Set FIREBASE_BLACK_* env vars with a valid service account key."
    );
  }
  return app;
}

function blackStorageBucketName(): string {
  const explicit =
    process.env.FIREBASE_BLACK_STORAGE_BUCKET?.trim() ||
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.GCLOUD_STORAGE_BUCKET?.trim();
  if (explicit) return explicit;

  const projectId = process.env.FIREBASE_BLACK_PROJECT_ID?.trim();
  if (projectId) return `${projectId}.appspot.com`;

  throw new Error(
    "Firebase Black Storage bucket is not configured. Set FIREBASE_BLACK_STORAGE_BUCKET, e.g. bmspro-black.appspot.com."
  );
}

function blackAgentActivitiesCollectionName(): string {
  return (
    process.env.FIREBASE_BLACK_AGENT_ACTIVITIES_COLLECTION?.trim() ||
    DEFAULT_COLLECTION
  );
}

function fieldString(
  fields: Record<string, unknown>,
  name: string
): string | undefined {
  const value = fields[name];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" && first.trim() ? first.trim() : undefined;
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizePathPart(value: string): string {
  const safe = value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 120);
  return safe || "unknown";
}

function storageDownloadUrl(
  bucketName: string,
  storagePath: string,
  token: string
): string {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
    bucketName
  )}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(
    token
  )}`;
}

function metadataFromFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS) {
    const value = fieldString(fields, field);
    if (value === undefined) continue;
    if (field === "recordingSizeBytes") {
      const numberValue = Number(value);
      out[field] = Number.isFinite(numberValue) ? numberValue : value;
    } else {
      out[field] = value;
    }
  }
  return out;
}

async function uploadRecording(input: {
  file: Express.Multer.File;
  fields: Record<string, unknown>;
}): Promise<{
  recordingUrl: string;
  recordingFileName: string;
  recordingMimeType: string;
  recordingSizeBytes: number;
}> {
  const app = blackFirebase();
  const bucketName = blackStorageBucketName();
  const bucket = getStorage(app).bucket(bucketName);

  const callId =
    fieldString(input.fields, "recordingCallId") ??
    fieldString(input.fields, "callId") ??
    "call";
  const ownerId =
    fieldString(input.fields, "ownerId") ??
    fieldString(input.fields, "tenantId") ??
    "unknown-owner";
  const originalName =
    fieldString(input.fields, "recordingFileName") ??
    input.file.originalname ??
    "recording";
  const storagePath = [
    STORAGE_PREFIX,
    sanitizePathPart(ownerId),
    new Date().toISOString().slice(0, 10),
    `${sanitizePathPart(callId)}-${randomUUID()}-${sanitizePathPart(originalName)}`,
  ].join("/");
  const token = randomUUID();
  const contentType = input.file.mimetype || "application/octet-stream";

  await bucket.file(storagePath).save(input.file.buffer, {
    resumable: false,
    contentType,
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
        originalName,
        callId,
      },
    },
  });

  return {
    recordingUrl: storageDownloadUrl(bucketName, storagePath, token),
    recordingFileName: storagePath,
    recordingMimeType: contentType,
    recordingSizeBytes: input.file.size,
  };
}

export async function saveBlackAgentActivity(
  input: SaveBlackAgentActivityInput
): Promise<SaveBlackAgentActivityResult> {
  const app = blackFirebase();
  const db = app.firestore();
  const collectionName = blackAgentActivitiesCollectionName();
  const doc = db.collection(collectionName).doc();

  const data: Record<string, unknown> = {
    id: doc.id,
    ...metadataFromFields(input.fields),
    source: "command-center",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (input.authenticatedSupabaseUserId) {
    data.authenticatedSupabaseUserId = input.authenticatedSupabaseUserId;
  }

  if (input.recording) {
    const uploaded = await uploadRecording({
      file: input.recording,
      fields: input.fields,
    });
    data.recordingUrl = uploaded.recordingUrl;
    data.recordingFileName = uploaded.recordingFileName;
    data.recordingMimeType = uploaded.recordingMimeType;
    data.recordingSizeBytes = uploaded.recordingSizeBytes;
    data.recordingStoragePath = uploaded.recordingFileName;
    data.recordingOriginalFileName = input.recording.originalname;
  } else {
    data.recordingUrl = fieldString(input.fields, "recordingUrl") ?? null;
    data.recordingFileName = fieldString(input.fields, "recordingFileName") ?? null;
  }

  await doc.set(data);

  const saved = await doc.get();
  if (!saved.exists) {
    throw new Error(
      `Firestore write did not create ${collectionName}/${doc.id}.`
    );
  }

  return {
    id: doc.id,
    collection: collectionName,
    firestorePath: doc.path,
    recordingUrl:
      typeof data.recordingUrl === "string" ? data.recordingUrl : null,
    recordingFileName:
      typeof data.recordingFileName === "string" ? data.recordingFileName : null,
  };
}
