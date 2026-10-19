import { randomUUID } from "node:crypto";

import type { VoiceMediaAdapter } from "./voice-media-adapter.js";
import type {
  TelephonyControlAdapter,
  VerifiedPbxEvent,
} from "./telephony-control-adapter.js";

export type ActiveVoiceCall = {
  sessionId: string;
  callId: string;
  tenantId: string;
  brand: "black" | "trade" | "pink";
  branchId: string | null;
  did: string;
  status: "active" | "handed_off" | "closed";
};

/**
 * Provider-neutral call lifecycle. Production callers must pass an event only
 * after provider-specific signature, timestamp and replay verification.
 */
export class VoiceCallOrchestrator {
  private readonly calls = new Map<string, ActiveVoiceCall>();
  private readonly fallbackByCall = new Map<string, string>();

  constructor(
    private readonly telephony: TelephonyControlAdapter,
    private readonly media: VoiceMediaAdapter,
  ) {}

  async startInbound(event: VerifiedPbxEvent): Promise<ActiveVoiceCall> {
    if (event.kind !== "inbound_started") {
      throw new Error("Only an inbound-start event can create a voice session.");
    }
    if (!event.eventId.trim() || !event.callId.trim() || !event.did.trim()) {
      throw new Error("Inbound event is missing required identifiers.");
    }
    if (this.calls.has(event.callId)) return { ...this.calls.get(event.callId)! };

    const context = await this.telephony.lookupInboundEvent(event);
    const sessionId = randomUUID();
    const allowedTools = ["get_workshop_profile", "list_services"] as const;
    await this.media.open({
      sessionId,
      tenantId: context.tenantId,
      did: context.did,
      branchId: context.branchId,
      allowedTools,
      persistAudio: false,
      persistTranscript: false,
    });
    try {
      await this.telephony.answer(event.callId);
    } catch (error) {
      await this.media.close(sessionId).catch(() => undefined);
      throw error;
    }

    const call: ActiveVoiceCall = {
      sessionId,
      callId: event.callId,
      tenantId: context.tenantId,
      brand: context.brand,
      branchId: context.branchId,
      did: context.did,
      status: "active",
    };
    this.calls.set(event.callId, call);
    this.fallbackByCall.set(event.callId, context.humanFallback);
    return { ...call };
  }

  async handoffToStaff(callId: string): Promise<ActiveVoiceCall> {
    const call = this.requireActiveCall(callId);
    const fallback = this.fallbackByCall.get(callId);
    if (!fallback) throw new Error("Configured human fallback was not found.");
    await this.telephony.transfer(call.callId, fallback);
    await this.media.close(call.sessionId);
    call.status = "handed_off";
    this.calls.delete(callId);
    this.fallbackByCall.delete(callId);
    return { ...call };
  }

  async close(callId: string): Promise<ActiveVoiceCall> {
    const call = this.requireActiveCall(callId);
    await this.media.close(call.sessionId);
    await this.telephony.hangup(call.callId);
    call.status = "closed";
    this.calls.delete(callId);
    this.fallbackByCall.delete(callId);
    return { ...call };
  }

  private requireActiveCall(callId: string): ActiveVoiceCall {
    const call = this.calls.get(callId);
    if (!call || call.status !== "active") throw new Error("Active voice call was not found.");
    return call;
  }
}
