import type {
  SafeVoiceToolCall,
  VoiceAudioFrame,
  VoiceMediaAdapter,
  VoiceMediaSessionConfig,
} from "./voice-media-adapter.js";

/**
 * Local-only media stub. It deliberately discards outbound frames and emits no
 * inbound audio; it cannot connect to Yeastar or a voice provider.
 */
export class MockVoiceMediaAdapter implements VoiceMediaAdapter {
  private readonly openSessions = new Map<string, VoiceMediaSessionConfig>();
  private readonly audioHandlers = new Map<string, Set<(frame: VoiceAudioFrame) => void>>();
  private readonly toolHandlers = new Map<string, Set<(call: SafeVoiceToolCall) => Promise<unknown>>>();

  async open(config: VoiceMediaSessionConfig): Promise<void> {
    if (config.persistAudio || config.persistTranscript) {
      throw new Error("Mock voice media does not allow durable audio or transcript storage.");
    }
    this.openSessions.set(config.sessionId, config);
  }

  async sendAudio(sessionId: string, _frame: VoiceAudioFrame): Promise<void> {
    if (!this.openSessions.has(sessionId)) {
      throw new Error("Mock voice media session is not open.");
    }
    // Audio is intentionally discarded; the mock never persists or forwards it.
  }

  onAudio(
    sessionId: string,
    handler: (frame: VoiceAudioFrame) => void,
  ): () => void {
    if (!this.openSessions.has(sessionId)) {
      throw new Error("Mock voice media session is not open.");
    }
    const handlers = this.audioHandlers.get(sessionId) ?? new Set();
    handlers.add(handler);
    this.audioHandlers.set(sessionId, handlers);
    return () => handlers.delete(handler);
  }

  onToolCall(
    sessionId: string,
    handler: (call: SafeVoiceToolCall) => Promise<unknown>,
  ): () => void {
    if (!this.openSessions.has(sessionId)) {
      throw new Error("Mock voice media session is not open.");
    }
    const handlers = this.toolHandlers.get(sessionId) ?? new Set();
    handlers.add(handler);
    this.toolHandlers.set(sessionId, handlers);
    return () => handlers.delete(handler);
  }

  /** Test-only fixture injection; real providers must implement their own ingress. */
  simulateInboundAudio(sessionId: string, frame: VoiceAudioFrame): void {
    if (!this.openSessions.has(sessionId)) {
      throw new Error("Mock voice media session is not open.");
    }
    for (const handler of this.audioHandlers.get(sessionId) ?? []) handler(frame);
  }

  /** Test-only tool invocation; no production provider can call this method. */
  async simulateToolCall(sessionId: string, call: SafeVoiceToolCall): Promise<unknown[]> {
    if (!this.openSessions.has(sessionId)) {
      throw new Error("Mock voice media session is not open.");
    }
    const config = this.openSessions.get(sessionId)!;
    if (!config.allowedTools.includes(call.name)) {
      throw new Error("Tool is not allowed for this voice session.");
    }
    const handlers = this.toolHandlers.get(sessionId);
    if (!handlers?.size) throw new Error("No tool handler is registered.");
    return Promise.all([...handlers].map((handler) => handler(call)));
  }

  async close(sessionId: string): Promise<void> {
    this.openSessions.delete(sessionId);
    this.audioHandlers.delete(sessionId);
    this.toolHandlers.delete(sessionId);
  }
}

export const mockVoiceMediaAdapter = new MockVoiceMediaAdapter();
