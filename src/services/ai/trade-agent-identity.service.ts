import admin from "firebase-admin";
import { getFirebaseBlueApp } from "../../db/firebase/firebase.blue.js";
import { activeTradeAgent, mappedTradeBusiness, tradeAiAgentUid } from "./trade-ai-agent-provisioning.service.js";

type Identity = { token: string; expiresAt: number };
export class TradeAgentIdentityError extends Error {
  readonly code = "TRADE_AGENT_SETUP_REQUIRED";
}
export type TradeIdentityDependencies = {
  getMapping: (did: string) => Promise<{ did: string; owner_id: string | null }>;
  getUser: (uid: string) => Promise<{ disabled: boolean; customClaims?: Record<string, unknown> }>;
  getAgent: (uid: string) => Promise<Record<string, unknown> | undefined>;
  createCustomToken: (uid: string) => Promise<string>;
  exchangeCustomToken: (token: string) => Promise<{ token: string; expiresIn: number }>;
};

/** Recheck the live DID assignment and account state even when reusing a token. */
export function createTradeAgentIdentity(deps: TradeIdentityDependencies, now: () => number = Date.now) {
 const cached = new Map<string, Identity>();
 const pending = new Map<string, Promise<Identity>>();
 return async (did: string, businessId: string): Promise<string> => {
  const mapping = await deps.getMapping(did);
  if (mapping.owner_id !== businessId) throw new Error("The Trade DID business assignment changed.");
  const uid = tradeAiAgentUid(mapping.did);
  const [user, doc] = await Promise.all([deps.getUser(uid), deps.getAgent(uid)]);
  if (user.disabled || !activeTradeAgent(doc, mapping.did, businessId) || user.customClaims?.role !== "ai_receptionist" ||
      user.customClaims?.aiFrontOffice !== true || user.customClaims?.brand !== "trade") {
    throw new TradeAgentIdentityError("Create an active Trade AI receptionist account assigned to this business first.");
  }
  const key = JSON.stringify([uid, businessId]);
  const existing = cached.get(key);
  if (existing && existing.expiresAt - 180_000 > now()) return existing.token;
  let task = pending.get(key);
  if (!task) {
    task = (async () => {
      const customToken = await deps.createCustomToken(uid);
      const body = await deps.exchangeCustomToken(customToken);
      if (!body.token) throw new Error("Trade AI receptionist sign-in failed.");
      const seconds = body.expiresIn;
      const identity = { token: body.token, expiresAt: now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000 };
      cached.set(key, identity);
      return identity;
    })().finally(() => pending.delete(key));
    pending.set(key, task);
  }
  return (await task).token;
 };
}

function blueApp() {
  const app = getFirebaseBlueApp();
  if (!app) throw new TradeAgentIdentityError("Firebase Blue is not configured.");
  return app;
}

export const getTradeAgentIdToken = createTradeAgentIdentity({
  getMapping: mappedTradeBusiness,
  getUser: uid => admin.auth(blueApp()).getUser(uid),
  getAgent: async uid => (await admin.firestore(blueApp()).doc(`call_center_agents/${uid}`).get()).data(),
  createCustomToken: uid => admin.auth(blueApp()).createCustomToken(uid),
  exchangeCustomToken: async token => {
    const apiKey = process.env.FIREBASE_BLUE_WEB_API_KEY?.trim();
    if (!apiKey) throw new TradeAgentIdentityError("Firebase Blue sign-in is not configured.");
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, returnSecureToken: true }), signal: AbortSignal.timeout(15_000) });
    const body = await response.json() as { idToken?: unknown; expiresIn?: unknown };
    if (!response.ok || typeof body.idToken !== "string" || !body.idToken) throw new TradeAgentIdentityError("Trade AI receptionist sign-in failed.");
    return { token: body.idToken, expiresIn: Number(body.expiresIn) };
  },
});
