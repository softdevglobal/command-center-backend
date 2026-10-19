import assert from "node:assert/strict";
import test from "node:test";

import { MockTelephonyControlAdapter } from "../src/services/ai/mock-telephony-control.adapter.js";
import { MockVoiceMediaAdapter } from "../src/services/ai/mock-voice-media.adapter.js";
import { VoiceCallOrchestrator } from "../src/services/ai/voice-call-orchestrator.service.js";
import type { InboundCallContext } from "../src/services/ai/telephony-control-adapter.js";

const context: InboundCallContext = {
  did: "+61400000000",
  tenantId: "tenant-a",
  brand: "black",
  branchId: "branch-a",
  timeZone: "Australia/Sydney",
  humanFallback: "queue-a",
};

test("mock PBX control resolves server DID context and simulates call actions", async () => {
  const adapter = new MockTelephonyControlAdapter(async (did) => did === context.did ? context : null);
  const event = {
    eventId: "event-1",
    callId: "call-1",
    did: context.did,
    occurredAt: new Date().toISOString(),
    kind: "inbound_started" as const,
  };

  assert.deepEqual(await adapter.lookupInboundEvent(event), context);
  await adapter.answer(event.callId);
  await adapter.transfer(event.callId, context.humanFallback);
  await adapter.hangup(event.callId);
  assert.deepEqual(adapter.actions.map(({ action }) => action), ["answer", "transfer", "hangup"]);
  await assert.rejects(adapter.answer("unknown-call"), /Call context/);
  await assert.rejects(adapter.lookupInboundEvent({ ...event, did: "+61409999999" }), /not mapped/);
});

test("orchestrator pins tenant and opens no-retention media before answering; handoff uses mapped queue", async () => {
  const control = new MockTelephonyControlAdapter(async (did) => did === context.did ? context : null);
  const media = new MockVoiceMediaAdapter();
  const orchestrator = new VoiceCallOrchestrator(control, media);
  const call = await orchestrator.startInbound({
    eventId: "event-orchestration-1",
    callId: "call-orchestration-1",
    did: context.did,
    occurredAt: new Date().toISOString(),
    kind: "inbound_started",
  });

  assert.equal(call.tenantId, context.tenantId);
  assert.equal(call.branchId, context.branchId);
  assert.equal(control.actions[0]?.action, "answer");
  const handoff = await orchestrator.handoffToStaff(call.callId);
  assert.equal(handoff.status, "handed_off");
  assert.deepEqual(control.actions.slice(1), [{
    callId: call.callId,
    action: "transfer",
    target: context.humanFallback,
  }]);
  await assert.rejects(orchestrator.close(call.callId), /not found/);
});

test("mock media exchanges only injected audio and server-allowed tool calls, retaining no frames", async () => {
  const adapter = new MockVoiceMediaAdapter();
  await adapter.open({
    sessionId: "session-1",
    tenantId: context.tenantId,
    did: context.did,
    branchId: context.branchId,
    allowedTools: ["get_workshop_profile"],
    persistAudio: false,
    persistTranscript: false,
  });

  const received: Uint8Array[] = [];
  adapter.onAudio("session-1", (frame) => received.push(frame.data));
  const fixture = new Uint8Array([0, 1, 2, 3]);
  adapter.simulateInboundAudio("session-1", {
    data: fixture,
    codec: "pcm16",
    sampleRateHz: 16000,
    channels: 1,
  });
  await adapter.sendAudio("session-1", {
    data: new Uint8Array([4, 5]),
    codec: "pcm16",
    sampleRateHz: 16000,
    channels: 1,
  });

  adapter.onToolCall("session-1", async ({ name }) => ({ name, simulated: true }));
  assert.deepEqual(await adapter.simulateToolCall("session-1", {
    name: "get_workshop_profile",
    arguments: {},
  }), [{ name: "get_workshop_profile", simulated: true }]);
  await assert.rejects(adapter.simulateToolCall("session-1", {
    name: "create_booking",
    arguments: {},
  }), /not allowed/);
  assert.equal(received.length, 1);
  assert.equal(received[0], fixture);

  await assert.rejects(adapter.open({
    sessionId: "bad-session",
    tenantId: context.tenantId,
    did: context.did,
    branchId: context.branchId,
    allowedTools: [],
    persistAudio: true as false,
    persistTranscript: false,
  }), /does not allow/);
  await adapter.close("session-1");
  assert.throws(() => adapter.simulateInboundAudio("session-1", {
    data: fixture,
    codec: "pcm16",
    sampleRateHz: 16000,
    channels: 1,
  }), /not open/);
});
