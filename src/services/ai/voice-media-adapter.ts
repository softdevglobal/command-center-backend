export type VoiceAudioFrame = {
  data: Uint8Array;
  codec: "pcm16" | "opus";
  sampleRateHz: number;
  channels: 1 | 2;
};

export type VoiceMediaSessionConfig = {
  sessionId: string;
  tenantId: string;
  did: string;
  branchId: string | null;
  /** Tool names are fixed by the server before media opens. */
  allowedTools: readonly string[];
  /** Durable audio and transcript persistence are disabled by default. */
  persistAudio: false;
  persistTranscript: false;
};

export type SafeVoiceToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

/** Server-side contract for a future PBX/voice-provider media implementation. */
export interface VoiceMediaAdapter {
  open(config: VoiceMediaSessionConfig): Promise<void>;
  sendAudio(sessionId: string, frame: VoiceAudioFrame): Promise<void>;
  onAudio(
    sessionId: string,
    handler: (frame: VoiceAudioFrame) => void,
  ): () => void;
  onToolCall(
    sessionId: string,
    handler: (call: SafeVoiceToolCall) => Promise<unknown>,
  ): () => void;
  close(sessionId: string): Promise<void>;
}
