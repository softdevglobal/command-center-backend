import admin from "firebase-admin";

import { getFirebaseBlackApp } from "../db/firebase/firebase.black.js";
import { getFirebaseBlueApp } from "../db/firebase/firebase.blue.js";
import { getFirebasePinkApp } from "../db/firebase/firebase.pink.js";
import type { CreateAgentRequestBody } from "../types/agent-registration.types.js";

const CREATED_BY_CC = "command-center";

/**
 * Black / Pink `call_center_agents/{firebaseUid}` shape (BMS admin panel).
 * Fields: email, displayName, name, role, assignedWorkshops, suspended, extension, phone, …
 */
function buildBlackPinkAgentPayload(
  body: CreateAgentRequestBody
): Record<string, unknown> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const extension = String(body.extension ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const notes = String(body.notes ?? "").trim();
  const agentTypeLabel =
    String(body.agentType ?? "workshop").trim() === "command-centre"
      ? "command-centre"
      : "workshop";
  const workshopOwnerUid = String(body.workshopOwnerUid ?? "").trim();
  const assignedWorkshops =
    agentTypeLabel === "workshop" && workshopOwnerUid ? [workshopOwnerUid] : [];

  const now = new Date();

  return {
    email,
    displayName: name,
    name,
    role: "agent",
    assignedWorkshops,
    suspended: false,
    extension,
    phone,
    notes,
    agentType: agentTypeLabel,
    groupIds: [],
    queueIds: [],
    invitedAt: now.toISOString(),
    createdBy: CREATED_BY_CC,
    createdByRole: "system",
  };
}

/**
 * Blue (bmspro-trade) `call_center_agents/{firebaseUid}` — trade Command Center UI.
 *
 * Example document:
 *   activeChatCount, agentType, email, extension, groupIds[], invitedAt, lastSeenAt,
 *   name, notes, phone, queueIds[], role, status, supabaseUserId, tenantId,
 *   workshopBranchId, workshopBranchName, workshopName, workshopOwnerUid, workshopUserRole
 *
 * Document id = Firebase Blue Auth uid (not Supabase user id).
 */
function buildBlueCallCenterAgentPayload(
  body: CreateAgentRequestBody,
  supabaseUserId: string
): Record<string, unknown> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const extension = String(body.extension ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const notes = String(body.notes ?? "").trim() || "";
  const agentTypeLabel =
    String(body.agentType ?? "workshop").trim() === "command-centre"
      ? "command-centre"
      : "workshop";

  const now = new Date();

  return {
    activeChatCount: 0,
    agentType: agentTypeLabel,
    email,
    extension,
    groupIds: [],
    invitedAt: now.toISOString(),
    lastSeenAt: now,
    name,
    notes,
    phone,
    queueIds: [],
    role: "agent",
    status: "offline",
    supabaseUserId,
    tenantId: String(body.tenantId ?? "").trim(),
    workshopBranchId: String(body.workshopBranchId ?? "").trim(),
    workshopBranchName: String(body.workshopBranchName ?? "").trim(),
    workshopName: String(body.workshopName ?? "").trim(),
    workshopOwnerUid: String(body.workshopOwnerUid ?? "").trim(),
    workshopUserRole: String(body.workshopUserRole ?? "").trim(),
  };
}

async function upsertCallCenterAgentDoc(
  app: admin.app.App,
  firebaseUid: string,
  payload: Record<string, unknown>
): Promise<void> {
  const ref = admin.firestore(app).doc(`call_center_agents/${firebaseUid}`);
  const snap = await ref.get();
  const now = new Date();
  await ref.set(
    {
      ...payload,
      updatedAt: now,
      ...(snap.exists ? {} : { createdAt: now }),
    },
    { merge: true }
  );
}

async function upsertBlueCallCenterAgentDoc(
  app: admin.app.App,
  firebaseUid: string,
  payload: Record<string, unknown>
): Promise<void> {
  const ref = admin.firestore(app).doc(`call_center_agents/${firebaseUid}`);
  await ref.set(payload, { merge: true });
}

/**
 * Writes `call_center_agents/{uid}` in BMS Black, Pink, and Blue (trade) Firestore.
 * Black/Pink share one schema; Blue uses the trade Command Center field set.
 */
export async function syncCallCenterAgentToBlackPinkBlueFirestore(input: {
  body: CreateAgentRequestBody;
  supabaseUserId: string;
  firebaseBlackUid: string;
  firebasePinkUid: string;
  firebaseBlueUid: string;
}): Promise<void> {
  const {
    body,
    supabaseUserId,
    firebaseBlackUid,
    firebasePinkUid,
    firebaseBlueUid,
  } = input;

  const black = getFirebaseBlackApp();
  const pink = getFirebasePinkApp();
  const blue = getFirebaseBlueApp();
  if (!black || !pink || !blue) {
    throw new Error(
      "Firebase Black, Pink, and Blue Admin SDK must all be configured to sync call_center_agents documents."
    );
  }

  const blackPinkPayload = buildBlackPinkAgentPayload(body);
  const bluePayload = buildBlueCallCenterAgentPayload(body, supabaseUserId);

  await Promise.all([
    upsertCallCenterAgentDoc(black, firebaseBlackUid, blackPinkPayload),
    upsertCallCenterAgentDoc(pink, firebasePinkUid, blackPinkPayload),
    upsertBlueCallCenterAgentDoc(blue, firebaseBlueUid, bluePayload),
  ]);
}
