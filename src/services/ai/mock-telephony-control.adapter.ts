import type {
  InboundCallContext,
  TelephonyControlAdapter,
  VerifiedPbxEvent,
} from "./telephony-control-adapter.js";

/** Local-only control-plane simulator. It never calls a PBX. */
export class MockTelephonyControlAdapter implements TelephonyControlAdapter {
  private readonly contextsByCall = new Map<string, InboundCallContext>();
  readonly actions: Array<{ callId: string; action: "answer" | "transfer" | "hangup"; target?: string }> = [];

  constructor(
    private readonly resolveDid: (did: string) => Promise<InboundCallContext | null>,
  ) {}

  async lookupInboundEvent(event: VerifiedPbxEvent): Promise<InboundCallContext> {
    if (event.kind !== "inbound_started" || !event.eventId || !event.callId || !event.did) {
      throw new Error("Mock adapter requires a complete inbound call event.");
    }
    const context = await this.resolveDid(event.did);
    if (!context || context.did !== event.did) {
      throw new Error("Inbound DID is not mapped to an active tenant.");
    }
    this.contextsByCall.set(event.callId, context);
    return context;
  }

  async answer(callId: string): Promise<void> {
    this.assertKnownCall(callId);
    this.actions.push({ callId, action: "answer" });
  }

  async transfer(callId: string, target: string): Promise<void> {
    this.assertKnownCall(callId);
    if (!target.trim()) throw new Error("A configured human fallback is required.");
    this.actions.push({ callId, action: "transfer", target });
  }

  async hangup(callId: string): Promise<void> {
    this.assertKnownCall(callId);
    this.actions.push({ callId, action: "hangup" });
    this.contextsByCall.delete(callId);
  }

  private assertKnownCall(callId: string): void {
    if (!this.contextsByCall.has(callId)) {
      throw new Error("Call context has not been resolved by the mock adapter.");
    }
  }
}
