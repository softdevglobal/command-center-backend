/**
 * A PBX event is trusted only after the provider-specific ingress has verified
 * its signature, timestamp and replay key. Never construct this from request
 * JSON before those checks have completed.
 */
export type VerifiedPbxEvent = Readonly<{
  eventId: string;
  callId: string;
  did: string;
  occurredAt: string;
  kind: "inbound_started" | "caller_disconnected";
}>;

/** Resolved from the server's active DID mapping, never from model arguments. */
export type InboundCallContext = Readonly<{
  did: string;
  tenantId: string;
  brand: "black" | "trade" | "pink";
  branchId: string | null;
  timeZone: string | null;
  humanFallback: string;
}>;

/** Provider-neutral PBX control plane. Audio belongs to VoiceMediaAdapter. */
export interface TelephonyControlAdapter {
  lookupInboundEvent(event: VerifiedPbxEvent): Promise<InboundCallContext>;
  answer(callId: string): Promise<void>;
  transfer(callId: string, target: string): Promise<void>;
  hangup(callId: string): Promise<void>;
}
