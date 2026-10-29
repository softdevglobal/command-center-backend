import { createSupabaseClient, getSupabaseProjectUrl, getSupabaseServiceRoleKey } from "../../db/supabase/supabase.client.js";
import { getTextBeeConfig } from "../../config/textbee.js";

export type ReviewChannel = "sms" | "email";
export type ReviewDeliveryState = "not_sent" | "not_configured" | "invalid_recipient" | "processing" | "accepted" | "failed" | "unknown" | "storage_unavailable";
export type ReviewDelivery = { status: ReviewDeliveryState; code?: string };
export type ReviewNotifications = Record<ReviewChannel, ReviewDelivery>;
export type ReviewNotice = { draftId: string; configurationHash: string; reviewUrl: string; ownerEmail: string; ownerPhone?: string; purpose?: "review" | "account_setup" };
type StoredDelivery = { status: "processing" | "accepted" | "failed" | "unknown"; code: string | null; created_at: string };
type NoticeKey = Pick<ReviewNotice, "draftId" | "configurationHash">;
function storageDelivery(error: unknown): ReviewDelivery {
  const code = (error as { code?: unknown } | null)?.code;
  return { status: "storage_unavailable", code: typeof code === "string" && /^NOTIFICATION_LEDGER_[A-Z0-9_]{1,64}$/.test(code) ? code : "NOTIFICATION_LEDGER_FAILED" };
}
function ledgerError(error?: { code?: string } | null) {
  const code = error?.code?.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64) || "UNAVAILABLE";
  return Object.assign(new Error("Notification storage unavailable."), { code: `NOTIFICATION_LEDGER_${code}` });
}
export interface ReviewNoticeStore {
  claim(input: NoticeKey, channel: ReviewChannel): Promise<boolean>;
  /** Atomically reclaim a known failed delivery for an explicit resend. */
  retryFailed?(input: NoticeKey, channel: ReviewChannel): Promise<boolean>;
  read(input: NoticeKey, channel: ReviewChannel): Promise<StoredDelivery | null>;
  finish(input: NoticeKey, channel: ReviewChannel, result: ReviewDelivery): Promise<void>;
}
export type ReviewNoticeProviders = {
  configured(channel: ReviewChannel): boolean;
  send(channel: ReviewChannel, recipient: string, reviewUrl: string, purpose?: "review" | "account_setup"): Promise<ReviewDelivery>;
};

export function reviewSmsRecipient(value: string): string | null {
  let normalized = value.trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
  // Onboarding is for Australian businesses and callers commonly provide a
  // national number (for example, 04… or 03…) rather than an E.164 number.
  // Convert only clearly valid Australian 10-digit national numbers; keep
  // international numbers strict so we never guess a country code.
  if (/^0[23478]\d{8}$/.test(normalized)) normalized = `+61${normalized.slice(1)}`;
  else if (/^61[23478]\d{8}$/.test(normalized)) normalized = `+${normalized}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

const accountSetupText = (setupUrl: string) =>
  `BMS Pro: Your business account is ready. Set your password and sign in: ${setupUrl} This is a private setup link; do not forward it. Plan and billing requirements still apply.`;

function safeAccountSetupLog(input: ReviewNotice, channel: ReviewChannel): Record<string, string> {
  const publicLoginUrl = new URL("/login", new URL(input.reviewUrl).origin).toString();
  const redactedBody = accountSetupText("[PRIVATE PASSWORD-SETUP LINK REDACTED]");
  return {
    draftId: input.draftId,
    channel,
    status: "accepted",
    publicLoginUrl,
    ...(channel === "email" ? { subject: "Your BMS Pro account — set your password" } : {}),
    body: redactedBody,
  };
}

/** One durable claim per configuration/channel; uncertain sends are never retried automatically. */
export function createReviewNotifier(store: ReviewNoticeStore, providers: ReviewNoticeProviders) {
  async function current(input: NoticeKey, channel: ReviewChannel): Promise<ReviewDelivery> {
    const stored = await store.read(input, channel);
    if (!stored) return { status: "not_sent" };
    if (stored.status === "processing" && Date.now() - Date.parse(stored.created_at) > 60000)
      return { status: "unknown", code: "INTERRUPTED_SEND_CHECK_PROVIDER" };
    return { status: stored.status, ...(stored.code ? { code: stored.code } : {}) };
  }
  return {
    async get(input: NoticeKey): Promise<ReviewNotifications> {
      const values = await Promise.all((["sms", "email"] as const).map(async channel => {
        try { return await current(input, channel); }
        catch (error) { return storageDelivery(error); }
      }));
      return { sms: values[0]!, email: values[1]! };
    },
    async notify(input: ReviewNotice): Promise<ReviewNotifications> {
      const values = await Promise.all((["sms", "email"] as const).map(async channel => {
        // Always consult the ledger first: configuration changes must not hide a
        // previously accepted send or cause a duplicate.
        try {
          const existing = await current(input, channel);
          const retryingFailedDelivery = existing.status === "failed";
          if (existing.status !== "not_sent" && !retryingFailedDelivery) return existing;
          if (!providers.configured(channel)) return { status: "not_configured" as const };
          if (channel === "sms" && !input.ownerPhone?.trim()) return { status: "not_sent" as const, code: "PHONE_NOT_COLLECTED" };
          const recipient = channel === "sms" ? reviewSmsRecipient(input.ownerPhone ?? "") : input.ownerEmail.trim();
          if (!recipient || (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)))
            return { status: "invalid_recipient" as const };
          const url = new URL(input.reviewUrl);
          if (url.protocol !== "https:" || url.username || url.password || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
            return { status: "failed" as const, code: "PUBLIC_HTTPS_REVIEW_URL_REQUIRED" };
          const claimed = retryingFailedDelivery
            ? await store.retryFailed?.(input, channel) ?? false
            : await store.claim(input, channel);
          if (!claimed) return await current(input, channel);
          let result: ReviewDelivery;
          try { result = await providers.send(channel, recipient, input.reviewUrl, input.purpose); }
          catch { result = { status: "unknown", code: "PROVIDER_OUTCOME_UNKNOWN" }; }
          await store.finish(input, channel, result);
          if (input.purpose === "account_setup" && result.status === "accepted") {
            // Provider acceptance is logged for support; never log the private,
            // single-use password setup URL or the recipient's personal details.
            console.info("[onboarding-account-notifications] Message accepted; preview", safeAccountSetupLog(input, channel));
          }
          return result;
        } catch (error) { return storageDelivery(error); }
      }));
      return { sms: values[0]!, email: values[1]! };
    },
  };
}

function table() {
  const url = getSupabaseProjectUrl(), key = getSupabaseServiceRoleKey();
  if (!url || !key) throw ledgerError();
  return createSupabaseClient(url, key).from("ai_onboarding_review_notifications");
}
const store: ReviewNoticeStore = {
  async claim(input, channel) {
    const { error } = await table().insert({ draft_id: input.draftId, configuration_hash: input.configurationHash, channel, status: "processing" })
      .abortSignal(AbortSignal.timeout(5000));
    if (error?.code === "23505") return false;
    if (error) throw ledgerError(error);
    return true;
  },
  async read(input, channel) {
    const { data, error } = await table().select("status,code,created_at").eq("draft_id", input.draftId)
      .eq("configuration_hash", input.configurationHash).eq("channel", channel).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
    if (error) throw ledgerError(error);
    return data as StoredDelivery | null;
  },
  async retryFailed(input, channel) {
    const { data, error } = await table().update({ status: "processing", code: null, updated_at: new Date().toISOString() })
      .eq("draft_id", input.draftId).eq("configuration_hash", input.configurationHash).eq("channel", channel)
      .eq("status", "failed").select("channel").maybeSingle().abortSignal(AbortSignal.timeout(5000));
    if (error) throw ledgerError(error);
    return Boolean(data);
  },
  async finish(input, channel, result) {
    const { error } = await table().update({ status: result.status, code: result.code ?? null, updated_at: new Date().toISOString() })
      .eq("draft_id", input.draftId).eq("configuration_hash", input.configurationHash).eq("channel", channel)
      .eq("status", "processing").abortSignal(AbortSignal.timeout(5000));
    if (error) throw ledgerError(error);
  },
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const emailToken = () => (process.env.ZEPTOMAIL_SYSTEM_TOKEN || process.env.ZEPTOMAIL_TOKEN || "").trim();
export const reviewNoticeProviders: ReviewNoticeProviders = {
  configured(channel) {
    if (channel === "email") return Boolean(emailToken());
    const config = getTextBeeConfig();
    return Boolean(config.apiKey && config.deviceId);
  },
  async send(channel, recipient, reviewUrl, purpose) {
    const accountSetup = purpose === "account_setup";
    const text = accountSetup
      ? accountSetupText(reviewUrl)
      : `BMS Pro: Please review your business setup: ${reviewUrl} Sign in and verify your email to approve. This does not activate your account.`;
    let url: string, headers: Record<string, string>, body: unknown;
    if (channel === "sms") {
      const config = getTextBeeConfig();
      url = `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(config.deviceId)}/send-sms`;
      headers = { "Content-Type": "application/json", "x-api-key": config.apiKey };
      body = { recipients: [recipient], message: text, ...(config.simSubscriptionId ? { simSubscriptionId: config.simSubscriptionId } : {}) };
    } else {
      url = process.env.ZEPTOMAIL_URL?.trim() || "https://api.zeptomail.com.au/v1.1/email";
      if (new URL(url).protocol !== "https:") return { status: "failed", code: "EMAIL_HTTPS_REQUIRED" };
      const token = emailToken().replace(/^Zoho-enczapikey\s+/i, "");
      headers = { "Content-Type": "application/json", Authorization: `Zoho-enczapikey ${token}` };
      body = {
        from: { address: process.env.ZEPTOMAIL_SYSTEM_FROM_ADDRESS?.trim() || "noreply@bmspros.com.au", name: process.env.ZEPTOMAIL_SYSTEM_FROM_NAME?.trim() || "BMS Pro" },
        to: [{ email_address: { address: recipient } }],
        subject: accountSetup ? "Your BMS Pro account — set your password" : "Review your BMS Pro business setup",
        htmlbody: accountSetup
          ? `<p>Your BMS Pro business account has been created.</p><p><a href="${escapeHtml(reviewUrl)}">Set your password and sign in</a></p><p>No separate owner review or email-verification step is required. This private link expires and can only be used once. Do not forward it. Plan and billing requirements still apply.</p><p>If you did not request this account, do not use the link and contact BMS Pro support.</p>`
          : `<p>Your business setup is ready for owner review.</p><p><a href="${escapeHtml(reviewUrl)}">Review your business setup</a></p><p>Sign in and verify your email to approve the saved details. Approval does not activate your account.</p><p>If you did not request this setup, do not approve it.</p>`,
        textbody: text,
      };
    }
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: "error" });
    // Acceptance by the API is not proof of arrival at the handset or inbox.
    return response.ok ? { status: "accepted" } : { status: response.status >= 500 ? "unknown" : "failed", code: `${channel.toUpperCase()}_HTTP_${response.status}` };
  },
};

export const onboardingReviewNotifier = createReviewNotifier(store, reviewNoticeProviders);
