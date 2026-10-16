import admin from "firebase-admin";

import { getFirebaseBlackApp } from "../../db/firebase/firebase.black.js";
import { aiAgentUid } from "./black-ai-agent-provisioning.service.js";
import { getDidMappingByDid } from "../did-mappings.service.js";

type TenantCredential = {
  did: string;
  blackAgentUid: string;
};

type CachedIdentity = {
  idToken: string;
  expiresAt: number;
};

const identities = new Map<string, CachedIdentity>();
const refreshes = new Map<string, Promise<CachedIdentity>>();
const REFRESH_SKEW_MS = 3 * 60 * 1000;
const CUSTOM_TOKEN_EXCHANGE_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken";

function tenantCredentials(did: string): TenantCredential {
  const raw = process.env.AI_MCP_TENANT_CONFIG_JSON?.trim();
  if (!raw) return {did, blackAgentUid: aiAgentUid(did)};

  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    throw new Error("AI MCP tenant configuration is invalid.");
  }
  if (!Array.isArray(entries)) throw new Error("AI MCP tenant configuration is invalid.");

  const match = entries.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return item.brand === "black" && item.did === did;
  }) as Record<string, unknown> | undefined;

  if (!match) return {did, blackAgentUid: aiAgentUid(did)};
  if (typeof match.blackAgentUid !== "string" || !match.blackAgentUid.trim()) {
    throw new Error("BMS Black receptionist agent UID is not configured for this DID.");
  }
  return { did, blackAgentUid: match.blackAgentUid.trim() };
}

function assignedWorkshopIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return entry.trim();
    if (entry && typeof entry === "object") {
      const object = entry as Record<string, unknown>;
      const id = object.ownerUid ?? object.ownerId ?? object.uid;
      return typeof id === "string" ? id.trim() : "";
    }
    return "";
  }).filter(Boolean);
}

/** Verify the service identity is active and scoped to exactly this workshop. */
async function assertAgentScope(uid: string, ownerId: string, did: string): Promise<admin.app.App> {
  const app = getFirebaseBlackApp();
  if (!app) throw new Error("Firebase Black Admin credentials are not configured.");

  const [user, document] = await Promise.all([
    admin.auth(app).getUser(uid),
    admin.firestore(app).doc(`call_center_agents/${uid}`).get(),
  ]);
  const data = document.data();
  const workshops = assignedWorkshopIds(data?.assignedWorkshops);
  if (
    user.disabled ||
    !document.exists ||
    data?.role !== "agent" ||
    data?.suspended === true ||
    workshops.length !== 1 ||
    workshops[0] !== ownerId
  ) {
    throw new Error("BMS Black receptionist agent is inactive or not scoped to this workshop.");
  }
  if (uid === aiAgentUid(did)) {
    const mapping = await getDidMappingByDid(did);
    if (!mapping?.branch_id || mapping.owner_id !== ownerId || data?.accountType !== "ai-front-office" ||
        data.brand !== "black" || data.did !== did || data.ownerUid !== ownerId || data.branchId !== mapping.branch_id) {
      throw new Error("This DID needs an active AI account assigned to its current workshop and branch.");
    }
  }
  return app;
}

async function mintIdentity(did: string, ownerId: string): Promise<CachedIdentity> {
  const credential = tenantCredentials(did);
  const webApiKey = process.env.FIREBASE_BLACK_WEB_API_KEY?.trim();
  if (!webApiKey) throw new Error("Firebase Black sign-in is not configured.");

  const app = await assertAgentScope(credential.blackAgentUid, ownerId, did);
  const customToken = await admin.auth(app).createCustomToken(credential.blackAgentUid);
  const response = await fetch(`${CUSTOM_TOKEN_EXCHANGE_URL}?key=${encodeURIComponent(webApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Firebase Black sign-in returned an invalid response.");
  }
  if (!response.ok || !body || typeof body !== "object") {
    throw new Error("BMS Black receptionist agent sign-in failed.");
  }
  const result = body as Record<string, unknown>;
  const idToken = typeof result.idToken === "string" ? result.idToken.trim() : "";
  const seconds = Number.parseInt(String(result.expiresIn ?? "3600"), 10);
  if (!idToken) throw new Error("Firebase Black sign-in returned incomplete credentials.");
  return {
    idToken,
    expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
  };
}

/** Mints a short-lived token for an active Black agent assigned only to this workshop. */
export async function getBlackAgentIdToken(did: string, ownerId: string): Promise<string> {
  // Recheck the Firestore assignment before every use so stale or reassigned
  // service accounts cannot continue calling the Black API with a cached token.
  const credential = tenantCredentials(did);
  await assertAgentScope(credential.blackAgentUid, ownerId, did);

  const identityKey = JSON.stringify([did, ownerId, credential.blackAgentUid]);
  const cached = identities.get(identityKey);
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > Date.now()) return cached.idToken;

  let pending = refreshes.get(identityKey);
  if (!pending) {
    pending = mintIdentity(did, ownerId)
      .then((next) => {
        identities.set(identityKey, next);
        return next;
      })
      .finally(() => refreshes.delete(identityKey));
    refreshes.set(identityKey, pending);
  }
  return (await pending).idToken;
}
