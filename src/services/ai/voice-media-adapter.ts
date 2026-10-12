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
};

/** Server-side contract for a future PBX/voice-provider media implementation. */
export interface VoiceMediaAdapter {
  open(config: VoiceMediaSessionConfig): Promise<void>;
  sendAudio(sessionId: string, frame: VoiceAudioFrame): Promise<void>;
  onAudio(
    sessionId: string,
    handler: (frame: VoiceAudioFrame) => void,
  ): () => void;
  close(sessionId: string): Promise<void>;
}
