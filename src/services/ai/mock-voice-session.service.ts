import { randomUUID } from "node:crypto";

export type MockVoiceTenantContext = {
  did: string;
  tenantId: string;
  branchId: string | null;
  businessName: string | null;
};

export type MockVoiceSessionStatus = "open" | "handoff_requested" | "closed";

export type MockVoiceSession = {
  sessionId: string;
  provider: "mock";
  simulated: true;
  status: MockVoiceSessionStatus;
  tenant: MockVoiceTenantContext;
  createdAt: string;
  expiresAt: string;
  turnCount: number;
  greeting: string;
};

export type MockVoiceTurnResult = {
  sessionId: string;
  status: MockVoiceSessionStatus;
  simulated: true;
  response: string;
  handoffRequested: boolean;
  turnCount: number;
};

type StoredSession = MockVoiceSession & { expiresAtMs: number };

const SESSION_TTL_MS = 15 * 60 * 1000;
const sessions = new Map<string, StoredSession>();

const GREETING =
  "Hello! This is a simulated BMSPro receptionist. No live audio, AI model, or booking tools are connected. How can I help?";

function removeExpiredSessions(now: number): void {
  for (const [sessionId, session] of sessions) {
    if (session.expiresAtMs <= now) sessions.delete(sessionId);
  }
}

function publicSession(session: StoredSession): MockVoiceSession {
  const { expiresAtMs: _expiresAtMs, ...result } = session;
  return result;
}

export function createMockVoiceSession(
  tenant: MockVoiceTenantContext,
  now = Date.now(),
): MockVoiceSession {
  removeExpiredSessions(now);

  const session: StoredSession = {
    sessionId: randomUUID(),
    provider: "mock",
    simulated: true,
    status: "open",
    tenant,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    expiresAtMs: now + SESSION_TTL_MS,
    turnCount: 0,
    greeting: GREETING,
  };

  sessions.set(session.sessionId, session);
  return publicSession(session);
}

export function handleMockVoiceTurn(
  sessionId: string,
  callerText: string,
  now = Date.now(),
): MockVoiceTurnResult | null {
  removeExpiredSessions(now);
  const session = sessions.get(sessionId);
  if (!session || session.status === "closed") return null;

  const normalized = callerText.trim().toLowerCase();
  const handoffRequested =
    /\b(human|person|agent|staff|operator|someone)\b/.test(normalized);

  let response: string;
  if (handoffRequested) {
    session.status = "handoff_requested";
    response =
      "I understand you want a person. In a live deployment this would be handed to the business team; this mock cannot place or transfer calls.";
  } else if (/\b(book|booking|appointment|availability|available slot)\b/.test(normalized)) {
    response =
      "I can demonstrate the booking conversation, but this mock has no booking-system access and cannot create or confirm appointments.";
  } else {
    response =
      "The simulated receptionist is running, but it is not connected to a live language model or knowledge base yet. Ask for a human to see the mock handoff response.";
  }

  session.turnCount += 1;
  return {
    sessionId: session.sessionId,
    status: session.status,
    simulated: true,
    response,
    handoffRequested,
    turnCount: session.turnCount,
  };
}

export function closeMockVoiceSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.status === "closed") return false;

  session.status = "closed";
  sessions.delete(sessionId);
  return true;
}
