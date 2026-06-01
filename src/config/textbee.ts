function trimEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export type TextBeeConfig = {
  apiKey: string;
  deviceId: string;
  webhookSecret: string | null;
  simSubscriptionId: string | null;
};

export function getTextBeeConfig(): TextBeeConfig {
  return {
    apiKey: trimEnv(process.env.TEXTBEE_API_KEY) ?? "",
    deviceId: trimEnv(process.env.TEXTBEE_DEVICE_ID) ?? "",
    webhookSecret: trimEnv(process.env.TEXTBEE_WEBHOOK_SECRET),
    simSubscriptionId: trimEnv(process.env.TEXTBEE_SIM_SUBSCRIPTION_ID),
  };
}

export function getMissingTextBeeOutboundEnv(): string[] {
  const config = getTextBeeConfig();
  const missing: string[] = [];
  if (!config.apiKey) missing.push("TEXTBEE_API_KEY");
  if (!config.deviceId) missing.push("TEXTBEE_DEVICE_ID");
  return missing;
}
