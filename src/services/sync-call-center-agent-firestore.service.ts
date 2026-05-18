import admin from "firebase-admin";

import { getFirebaseBlackApp } from "../db/firebase/firebase.black.js";
import { getFirebasePinkApp } from "../db/firebase/firebase.pink.js";
import type { CreateAgentRequestBody } from "../types/agent-registration.types.js";

const CREATED_BY_CC = "command-center";

function buildAgentPayload(body: CreateAgentRequestBody): Record<string, unknown> {
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

/**
 * Writes `call_center_agents/{uid}` in **both** BMS Black and BMS Pink Firestore so admin UIs
 * and call-center APIs see the agent (Auth UID differs per project).
 */
export async function syncCallCenterAgentToBlackPinkFirestore(input: {
  body: CreateAgentRequestBody;
  firebaseBlackUid: string;
  firebasePinkUid: string;
}): Promise<void> {
  const { body, firebaseBlackUid, firebasePinkUid } = input;

  const black = getFirebaseBlackApp();
  const pink = getFirebasePinkApp();
  if (!black || !pink) {
    throw new Error(
      "Firebase Black and Pink Admin SDK must both be configured to sync call_center_agents documents."
    );
  }

  const payload = buildAgentPayload(body);

  await Promise.all([
    upsertCallCenterAgentDoc(black, firebaseBlackUid, payload),
    upsertCallCenterAgentDoc(pink, firebasePinkUid, payload),
  ]);
}
