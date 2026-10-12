import type {
  VoiceAudioFrame,
  VoiceMediaAdapter,
  VoiceMediaSessionConfig,
} from "./voice-media-adapter.js";

/**
 * Local-only media stub. It deliberately discards outbound frames and emits no
 * inbound audio; it cannot connect to Yeastar or a voice provider.
 */
export class MockVoiceMediaAdapter implements VoiceMediaAdapter {
  private readonly openSessions = new Set<string>();

  async open(config: VoiceMediaSessionConfig): Promise<void> {
    this.openSessions.add(config.sessionId);
  }

  async sendAudio(sessionId: string, _frame: VoiceAudioFrame): Promise<void> {
    if (!this.openSessions.has(sessionId)) {
      throw new Error("Mock voice media session is not open.");
    }
    // Audio is intentionally discarded; the mock never persists or forwards it.
  }

  onAudio(
    sessionId: string,
    _handler: (frame: VoiceAudioFrame) => void,
  ): () => void {
    if (!this.openSessions.has(sessionId)) {
      throw new Error("Mock voice media session is not open.");
    }
    // No inbound audio source exists in mock mode.
    return () => undefined;
  }

  async close(sessionId: string): Promise<void> {
    this.openSessions.delete(sessionId);
  }
}

export const mockVoiceMediaAdapter = new MockVoiceMediaAdapter();
