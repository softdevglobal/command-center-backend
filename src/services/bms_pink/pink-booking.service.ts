import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PinkMcpTenant } from "./pink-front-office.service.js";

const id = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date.");
const phone = z.string().trim().min(6).max(30).regex(/^[+\d][\d\s\-()]+$/)
  .refine(value => { const digits = value.replace(/\D/g, "").length; return digits >= 6 && digits <= 15; });
export const pinkAvailabilityArguments = z.object({ date, serviceIds: z.array(id).length(1) }).strict();
export const pinkBookingArguments = z.object({
  requestKey: z.string().trim().min(16).max(128), slotToken: z.string().uuid(), customerConfirmed: z.literal(true),
  customerName: z.string().trim().min(2).max(120), customerEmail: z.string().trim().email().max(254), customerPhone: phone,
  notes: z.string().trim().max(1000).optional(),
}).strict();
export type PinkSlotOffer = { date: string; time: string; serviceIds: string[]; expiresAt: number; did: string; ownerUid: string; branchId: string };
export type PinkNotificationDelivery = "accepted" | "failed" | "unknown" | "not_configured" | "not_sent" | "invalid_recipient" | "storage_unavailable";
export type PinkBookingNotifications = { customer: { email: PinkNotificationDelivery; sms: PinkNotificationDelivery }; owner: { email: PinkNotificationDelivery; sms: PinkNotificationDelivery } };
export type PinkSubmission = { status: "PENDING_REVIEW" | "CONFIRMED" | "REJECTED" | "UNKNOWN"; bookingId?: string; bookingCode?: string; message: string; notifications?: PinkBookingNotifications };
export type PinkSubmissionRecord = { fingerprint: string; result?: PinkSubmission };
type CatalogService = { id: unknown; name: unknown; duration?: unknown; price?: unknown };
export type PinkBookingDependencies = {
  scope(): Promise<PinkMcpTenant>;
  branch(tenant: PinkMcpTenant): Promise<{ timezone?: unknown }>;
  services(tenant: PinkMcpTenant): Promise<CatalogService[]>;
  availability(tenant: PinkMcpTenant, date: string, serviceIds: string[]): Promise<Record<string, unknown>>;
  saveOffer(token: string, offer: PinkSlotOffer): Promise<void>;
  readOffer(token: string): Promise<PinkSlotOffer | undefined>;
  readSubmission(key: string): Promise<PinkSubmissionRecord | undefined>;
  claim(key: string, fingerprint: string): Promise<PinkSubmissionRecord | undefined>;
  complete(key: string, result: PinkSubmission): Promise<void>;
  submit(tenant: PinkMcpTenant, payload: Record<string, unknown>, requestKey: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }>;
  notify?(input: { tenant: PinkMcpTenant; submissionKey: string; bookingId?: string; bookingCode?: string; confirmed: boolean; payload: Record<string, unknown> }): Promise<PinkBookingNotifications>;
  enabled(): boolean;
  now?: () => Date;
  uuid?: () => string;
};
const unknownResult: PinkSubmission = { status: "UNKNOWN", message: "The booking result could not be verified. Staff must check it; do not submit another request with a new key." };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

function availableTimes(body: Record<string, unknown>): string[] {
  if (body.dailyLimitReached === true) return [];
  const rows = Array.isArray(body.availableSlots) ? body.availableSlots : Array.isArray(body.slots) ? body.slots : null;
  if (!rows) throw new Error("Pink returned an invalid availability response.");
  return [...new Set(rows.flatMap(value => {
    const row = typeof value === "string" ? { time: value } : object(value);
    return typeof row.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.time) && row.available !== false && row.isAvailable !== false ? [row.time] : [];
  }))].sort();
}

/** All writes are injected so the complete booking flow can be verified offline. */
export function createPinkBookingTools(deps: PinkBookingDependencies) {
  const now = () => deps.now?.() ?? new Date();
  const replay = (record: PinkSubmissionRecord, fingerprint: string): PinkSubmission => record.fingerprint === fingerprint
    ? record.result ?? unknownResult
    : { status: "REJECTED", message: "This request key was used with different details. Ask staff to verify the original request." };
  return {
    async getAvailableSlots(raw: unknown) {
      const args = pinkAvailabilityArguments.parse(raw);
      const tenant = await deps.scope();
      const branch = await deps.branch(tenant);
      const timeZone = typeof branch.timezone === "string" && branch.timezone ? branch.timezone : "Australia/Sydney";
      const local = localClock(now(), timeZone), today = local.date;
      const requested = Date.parse(`${args.date}T00:00:00Z`), start = Date.parse(`${today}T00:00:00Z`);
      if (requested < start || requested > start + 90 * 86400000) throw new Error("Choose a date within the next 90 days.");
      const services = await deps.services(tenant);
      if (args.serviceIds.some(serviceId => !services.some(service => service.id === serviceId))) throw new Error("Select an active service offered by this salon branch.");
      const body = await deps.availability(tenant, args.date, args.serviceIds);
      const expiresAt = now().getTime() + 5 * 60000;
      const times = availableTimes(body).filter(time => args.date !== today || time > local.time);
      const slots = await Promise.all(times.map(async time => {
        const slotToken = deps.uuid?.() ?? randomUUID();
        await deps.saveOffer(slotToken, { date: args.date, time, serviceIds: [...args.serviceIds], expiresAt, did: tenant.did, ownerUid: tenant.ownerUid, branchId: tenant.branchId });
        return { time, slotToken, expiresAt: new Date(expiresAt).toISOString() };
      }));
      return { brand: "pink", date: args.date, timezone: timeZone, slots, message: slots.length
        ? "These times are availability results, not reservations. The booking is a request until Pink returns confirmed."
        : "No available times were returned for this date." };
    },
    async createBooking(raw: unknown) {
      if (!deps.enabled()) return { status: "DISABLED", message: "Pink AI booking writes are disabled. Offer staff assistance." };
      const args = pinkBookingArguments.parse(raw);
      const tenant = await deps.scope();
      // The request identity includes the offer and normalized customer details.
      // Read it before checking offer expiry so a retry recovers the original outcome.
      const key = createHash("sha256").update(JSON.stringify([tenant.did.replace(/^\+/, ""), tenant.ownerUid, tenant.branchId, args.requestKey])).digest("hex");
      const fingerprint = createHash("sha256").update(JSON.stringify({ ...args, customerEmail: args.customerEmail.toLowerCase() })).digest("hex");
      const previous = await deps.readSubmission(key);
      if (previous) return replay(previous, fingerprint);
      const offer = await deps.readOffer(args.slotToken);
      if (!offer || offer.expiresAt <= now().getTime() || offer.did !== tenant.did || offer.ownerUid !== tenant.ownerUid || offer.branchId !== tenant.branchId)
        return { status: "EXPIRED_SLOT", message: "This availability offer expired or is not valid for this salon. Check availability again." };
      const branch = await deps.branch(tenant);
      const local = localClock(now(), typeof branch.timezone === "string" && branch.timezone ? branch.timezone : "Australia/Sydney");
      if (offer.date < local.date || (offer.date === local.date && offer.time <= local.time))
        return { status: "EXPIRED_SLOT", message: "This appointment time has passed. Check availability again." };
      const services = await deps.services(tenant);
      const service = services.find(item => item.id === offer.serviceIds[0]);
      if (offer.serviceIds.length !== 1 || !service) return { status: "REJECTED", message: "The selected service is no longer available." };
      // A Firestore transaction claims the request before any upstream write.
      const existing = await deps.claim(key, fingerprint);
      if (existing) return replay(existing, fingerprint);
      let result: PinkSubmission;
      try {
        const availability = await deps.availability(tenant, offer.date, offer.serviceIds);
        if (!availableTimes(availability).includes(offer.time)) result = { status: "REJECTED", message: "That time is no longer available. Check another time." };
        else {
          const payload = { branchId: tenant.branchId, date: offer.date, time: offer.time, client: args.customerName,
            clientPhone: args.customerPhone, clientEmail: args.customerEmail.toLowerCase(), notes: args.notes ?? "",
            ...(typeof branch.name === "string" ? { branchName: branch.name } : {}),
            serviceId: service.id, serviceName: service.name, duration: service.duration, price: service.price,
            services: [{ serviceId: service.id, time: offer.time }], source: "ai_reception" };
          const response = await deps.submit(tenant, payload, args.requestKey);
          const body = response.body, booking = object(body.booking);
          const bookingId = [body.bookingId, body.id, booking.bookingId, booking.id].find(value => typeof value === "string" && value) as string | undefined;
          const bookingCode = [body.bookingCode, booking.bookingCode].find(value => typeof value === "string" && value) as string | undefined;
          const status = String(booking.status ?? body.status ?? "").toLowerCase();
          if (!response.ok) result = response.status >= 500 || [408, 409].includes(response.status) ? unknownResult : { status: "REJECTED", message: "Pink could not accept the booking request." };
          else if ((!bookingId && !bookingCode) || body.success === false || body.ok === false) result = unknownResult;
          else if (["rejected", "canceled", "cancelled"].includes(status)) result = { status: "REJECTED", message: "Pink did not accept the booking." };
          else result = { status: status === "confirmed" ? "CONFIRMED" : "PENDING_REVIEW", ...(bookingId ? { bookingId } : {}), ...(bookingCode ? { bookingCode } : {}),
            message: status === "confirmed" ? "Pink confirmed the booking." : "Pink received the booking request; the salon must review it." };
          if ((result.status === "CONFIRMED" || result.status === "PENDING_REVIEW") && deps.notify) {
            try {
              result.notifications = await deps.notify({ tenant, submissionKey: key, ...(bookingId ? { bookingId } : {}), ...(bookingCode ? { bookingCode } : {}), confirmed: result.status === "CONFIRMED", payload });
            } catch {
              // A notification failure must not turn a saved booking into an
              // unknown booking result or invite a duplicate booking retry.
              result.notifications = { customer: { email: "unknown", sms: "unknown" }, owner: { email: "unknown", sms: "unknown" } };
            }
          }
        }
      } catch { result = unknownResult; }
      try { await deps.complete(key, result); } catch { return unknownResult; }
      return result;
    },
  };
}
