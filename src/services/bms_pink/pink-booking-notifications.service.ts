import admin from "firebase-admin";
import { getFirebasePinkApp } from "../../db/firebase/firebase.pink.js";
import { getTextBeeConfig } from "../../config/textbee.js";
import { reviewSmsRecipient } from "../ai/onboarding-review-notification.service.js";
import type { PinkBookingNotifications, PinkNotificationDelivery } from "./pink-booking.service.js";
import type { PinkMcpTenant } from "./pink-front-office.service.js";

type PinkBookingNotice = {
  tenant: PinkMcpTenant;
  submissionKey: string;
  bookingId?: string;
  bookingCode?: string;
  confirmed: boolean;
  payload: Record<string, unknown>;
};

type NoticeChannel = "customer_email" | "customer_sms" | "owner_email" | "owner_sms";

const getText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const emailToken = () => (process.env.ZEPTOMAIL_SYSTEM_TOKEN || process.env.ZEPTOMAIL_TOKEN || "").trim().replace(/^Zoho-enczapikey\s+/i, "");

function validEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function providerEmail(input: { to: string; subject: string; text: string; html: string }): Promise<PinkNotificationDelivery> {
  const token = emailToken();
  if (!token) return "not_configured";
  const url = process.env.ZEPTOMAIL_URL?.trim() || "https://api.zeptomail.com.au/v1.1/email";
  if (!url.startsWith("https://")) return "failed";
  try {
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", Authorization: `Zoho-enczapikey ${token}` },
      body: JSON.stringify({
        from: { address: process.env.ZEPTOMAIL_SYSTEM_FROM_ADDRESS?.trim() || "noreply@bmspros.com.au", name: process.env.ZEPTOMAIL_SYSTEM_FROM_NAME?.trim() || "BMS Pro" },
        to: [{ email_address: { address: input.to } }], subject: input.subject, htmlbody: input.html, textbody: input.text,
      }),
    });
    return response.ok ? "accepted" : response.status >= 500 ? "unknown" : "failed";
  } catch (error) {
    return (error as { name?: string })?.name === "AbortError" || (error as { name?: string })?.name === "TimeoutError" ? "unknown" : "unknown";
  }
}

async function providerSms(to: string, message: string): Promise<PinkNotificationDelivery> {
  const config = getTextBeeConfig();
  if (!config.apiKey || !config.deviceId) return "not_configured";
  try {
    const response = await fetch(`https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(config.deviceId)}/send-sms`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "x-api-key": config.apiKey },
      body: JSON.stringify({ recipients: [to], message, ...(config.simSubscriptionId ? { simSubscriptionId: config.simSubscriptionId } : {}) }),
    });
    return response.ok ? "accepted" : response.status >= 500 ? "unknown" : "failed";
  } catch {
    return "unknown";
  }
}

function bookingDetails(input: PinkBookingNotice) {
  const payload = input.payload;
  const salon = getText(payload.branchName) || "the salon";
  const service = getText(payload.serviceName) || "your service";
  const date = getText(payload.date);
  const time = getText(payload.time);
  const code = input.bookingCode || input.bookingId || "pending";
  const when = [date, time].filter(Boolean).join(" at ");
  return { salon, service, date, time, code, when, customer: getText(payload.client) || "Customer" };
}

function emailContent(input: PinkBookingNotice, audience: "customer" | "owner") {
  const details = bookingDetails(input);
  const confirmed = input.confirmed;
  if (audience === "customer") {
    const subject = confirmed ? `Booking confirmed · ${details.salon}` : `Booking request received · ${details.salon}`;
    const text = confirmed
      ? `${details.salon}: Your booking${details.code !== "pending" ? ` (${details.code})` : ""} for ${details.service}${details.when ? ` on ${details.when}` : ""} is confirmed.`
      : `${details.salon}: We received your booking request${details.code !== "pending" ? ` (${details.code})` : ""} for ${details.service}${details.when ? ` on ${details.when}` : ""}. The salon will review it and contact you once confirmed.`;
    const html = `<p>${escapeHtml(text)}</p><p>Booking reference: ${escapeHtml(details.code)}</p>`;
    return { subject, text, html };
  }
  const subject = confirmed ? `Sophie confirmed a booking · ${details.code}` : `Sophie received a booking request · ${details.code}`;
  const text = confirmed
    ? `Sophie confirmed a booking for ${details.customer}: ${details.service}${details.when ? ` on ${details.when}` : ""}. Please review it in your Pink dashboard.`
    : `Sophie created a booking request for ${details.customer}: ${details.service}${details.when ? ` on ${details.when}` : ""}. Please review it in your Pink dashboard.`;
  return { subject, text, html: `<p>${escapeHtml(text)}</p><p>Booking reference: ${escapeHtml(details.code)}</p>` };
}

function smsContent(input: PinkBookingNotice, audience: "customer" | "owner") {
  const details = bookingDetails(input);
  if (audience === "customer") return input.confirmed
    ? `${details.salon}: Your booking${details.code !== "pending" ? ` ${details.code}` : ""} for ${details.service}${details.when ? ` on ${details.when}` : ""} is confirmed.`
    : `${details.salon}: We received your booking request${details.code !== "pending" ? ` ${details.code}` : ""} for ${details.service}${details.when ? ` on ${details.when}` : ""}. The salon will contact you once confirmed.`;
  return input.confirmed
    ? `Sophie confirmed a Pink booking${details.code !== "pending" ? ` ${details.code}` : ""}: ${details.customer}, ${details.service}${details.when ? ` on ${details.when}` : ""}. Please review your dashboard.`
    : `Sophie received a Pink booking request${details.code !== "pending" ? ` ${details.code}` : ""}: ${details.customer}, ${details.service}${details.when ? ` on ${details.when}` : ""}. Please review your dashboard.`;
}

/** Sends post-commit Pink customer and owner notices, once per request/channel. */
export async function sendPinkAiBookingNotifications(input: PinkBookingNotice): Promise<PinkBookingNotifications> {
  const app = getFirebasePinkApp();
  if (!app) return { customer: { email: "storage_unavailable", sms: "storage_unavailable" }, owner: { email: "storage_unavailable", sms: "storage_unavailable" } };
  const db = admin.firestore(app);
  let owner: admin.firestore.DocumentData = {};
  try { owner = (await db.collection("users").doc(input.tenant.ownerUid).get()).data() ?? {}; } catch { /* Customer delivery can still proceed. */ }
  let authUser: admin.auth.UserRecord | null = null;
  try { authUser = await admin.auth(app).getUser(input.tenant.ownerUid); } catch { /* Firestore contacts can still be used. */ }
  const ownerEmail = validEmail(getText(owner.email) || getText(owner.ownerEmail) || getText(authUser?.email));
  const ownerPhoneRaw = [owner.contactPhone, owner.ownerPhone, owner.phone, owner.phoneNumber, owner.mobile, authUser?.phoneNumber]
    .map(getText).find(Boolean) || "";
  const ownerPhone = reviewSmsRecipient(ownerPhoneRaw);
  const customerEmail = validEmail(getText(input.payload.clientEmail));
  const customerPhoneRaw = getText(input.payload.clientPhone);
  const customerPhone = reviewSmsRecipient(customerPhoneRaw);
  const result: PinkBookingNotifications = {
    customer: { email: "not_sent", sms: "not_sent" }, owner: { email: "not_sent", sms: "not_sent" },
  };
  const details = bookingDetails(input);
  const subjectAndText = {
    customer: emailContent(input, "customer"),
    owner: emailContent(input, "owner"),
  };
  const sms = { customer: smsContent(input, "customer"), owner: smsContent(input, "owner") };
  const deliveries: Array<{ key: NoticeChannel; recipient: string | null; result: PinkNotificationDelivery; send: () => Promise<PinkNotificationDelivery> }> = [
    { key: "customer_email", recipient: customerEmail, result: customerEmail ? "unknown" : "invalid_recipient", send: () => customerEmail ? providerEmail({ to: customerEmail, ...subjectAndText.customer }) : Promise.resolve("invalid_recipient") },
    { key: "customer_sms", recipient: customerPhone, result: customerPhone ? "unknown" : "invalid_recipient", send: () => customerPhone ? providerSms(customerPhone, sms.customer) : Promise.resolve("invalid_recipient") },
    { key: "owner_email", recipient: ownerEmail, result: ownerEmail ? "unknown" : "not_sent", send: () => ownerEmail ? providerEmail({ to: ownerEmail, ...subjectAndText.owner }) : Promise.resolve("not_sent") },
    { key: "owner_sms", recipient: ownerPhone, result: ownerPhone ? "unknown" : (ownerPhoneRaw ? "invalid_recipient" : "not_sent"), send: () => ownerPhone ? providerSms(ownerPhone, sms.owner) : Promise.resolve(ownerPhoneRaw ? "invalid_recipient" : "not_sent") },
  ];
  await Promise.all(deliveries.map(async delivery => {
    if (delivery.result === "invalid_recipient" || delivery.result === "not_sent") {
      if (delivery.key === "customer_email") result.customer.email = delivery.result;
      else if (delivery.key === "customer_sms") result.customer.sms = delivery.result;
      else if (delivery.key === "owner_email") result.owner.email = delivery.result;
      else result.owner.sms = delivery.result;
      return;
    }
    const channelConfigured = delivery.key.endsWith("_email") ? Boolean(emailToken()) : Boolean(getTextBeeConfig().apiKey && getTextBeeConfig().deviceId);
    if (!channelConfigured) {
      delivery.result = "not_configured";
      if (delivery.key === "customer_email") result.customer.email = delivery.result;
      else if (delivery.key === "customer_sms") result.customer.sms = delivery.result;
      else if (delivery.key === "owner_email") result.owner.email = delivery.result;
      else result.owner.sms = delivery.result;
      return;
    }
    const ref = db.collection("ai_pink_booking_notifications").doc(`${input.submissionKey}_${delivery.key}`);
    try {
      const claimed = await db.runTransaction(async transaction => {
        const existing = await transaction.get(ref);
        if (existing.exists) return false;
        transaction.create(ref, { submissionKey: input.submissionKey, bookingId: input.bookingId ?? null, bookingCode: input.bookingCode ?? null,
          ownerUid: input.tenant.ownerUid, channel: delivery.key, status: "processing", createdAt: admin.firestore.FieldValue.serverTimestamp() });
        return true;
      });
      if (!claimed) {
        const stored = (await ref.get()).data()?.status;
        delivery.result = stored === "accepted" || stored === "failed" || stored === "unknown" || stored === "not_configured" ? stored : "unknown";
      } else delivery.result = await delivery.send();
      if (claimed) await ref.update({ status: delivery.result, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch {
      delivery.result = "storage_unavailable";
    }
    if (delivery.key === "customer_email") result.customer.email = delivery.result;
    else if (delivery.key === "customer_sms") result.customer.sms = delivery.result;
    else if (delivery.key === "owner_email") result.owner.email = delivery.result;
    else result.owner.sms = delivery.result;
  }));
  console.info("[bms-pink-ai-booking-notifications] Provider outcomes", {
    bookingCode: details.code,
    customerEmail: result.customer.email, customerSms: result.customer.sms,
    ownerEmail: result.owner.email, ownerSms: result.owner.sms,
  });
  return result;
}
