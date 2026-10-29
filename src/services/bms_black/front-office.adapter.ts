import { proxyBlackCallCenterBranchById } from "../bms_black/black-call-center-branches.proxy.service.js";
import { proxyBlackCallCenterServicesByBranch } from "../bms_black/black-call-center-services.proxy.service.js";
import type {
  FrontOfficeBrandAdapter,
  FrontOfficeTenantContext,
} from "../ai/brand-adapter.js";
import { getBlackAgentIdToken } from "./agent-identity.service.js";
import { proxyBlackCallCenterBookingAvailability } from "./black-call-center-bookings.proxy.service.js";
import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";
import { localCalendar } from "../ai/front-office-booking.service.js";
import { staffAssignmentResult } from "../ai/staff-assignment-result.js";

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${label} request failed with HTTP ${response.status}.`);
  }
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(`${label} returned an invalid response.`);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeService(value: unknown): Record<string, unknown> | null {
  const row = record(value);
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;

  const result: Record<string, unknown> = {
    id: row.id,
    name: row.name,
  };
  for (const key of ["description", "price", "duration", "vehicleTypePricing", "pricingByVehicleType"]) {
    const candidate = row[key];
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      (candidate && typeof candidate === "object" && !Array.isArray(candidate))
    ) {
      if (candidate !== undefined) result[key] = candidate;
    }
  }
  return result;
}

export const blackFrontOfficeAdapter: FrontOfficeBrandAdapter = {
  brand: "black",

  async getBranch(context: FrontOfficeTenantContext): Promise<unknown> {
    const token = await getBlackAgentIdToken(context.did, context.ownerId);
    const body = record(await readJsonResponse(
      await proxyBlackCallCenterBranchById(token, context.ownerId, context.branchId),
      "BMS Black branch lookup",
    ));
    const branch = record(body.branch ?? body);
    const timeZone = typeof branch.timezone === "string" ? branch.timezone : typeof branch.timeZone === "string" ? branch.timeZone : undefined;
    const calendar = timeZone ? localCalendar(new Date(),timeZone) : undefined;
    // Keep this a business-hours/profile response; never return raw Firestore fields.
    return {
      id: context.branchId,
      name: typeof branch.name === "string" ? branch.name : context.branchName,
      address: typeof branch.address === "string" ? branch.address : undefined,
      phone: typeof branch.phone === "string" ? branch.phone : undefined,
      timeZone,
      currentLocalDate: calendar?.date,
      currentLocalTime: calendar?.time,
      daySchedules: branch.daySchedules,
      hours: branch.hours,
      daySchedule: branch.daySchedule,
      openingHours: branch.openingHours,
    };
  },

  async listServices(context: FrontOfficeTenantContext): Promise<unknown[]> {
    const token = await getBlackAgentIdToken(context.did, context.ownerId);
    const body = record(await readJsonResponse(
      await proxyBlackCallCenterServicesByBranch(
        token,
        context.ownerId,
        context.branchId,
      ),
      "BMS Black service lookup",
    ));
    return Array.isArray(body.services)
      ? body.services.map(safeService).filter((service): service is Record<string, unknown> => service !== null)
      : [];
  },

  async getAvailableSlots(context, query) {
    const token = await getBlackAgentIdToken(context.did, context.ownerId);
    const body = record(await readJsonResponse(await proxyBlackCallCenterBookingAvailability(token, context.ownerId, {
      branchId:context.branchId,date:query.date,serviceIds:query.serviceIds.join(","),
    }), "BMS Black availability"));
    const branch = record(body.branch);
    if (branch.id !== context.branchId || typeof branch.timezone !== "string") throw new Error("Black availability returned an invalid branch or timezone.");
    return {
      date:query.date,timeZone:branch.timezone,
      availableSlots:Array.isArray(body.availableSlots) ? body.availableSlots.filter((time):time is string => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) : [],
      dailyLimitReached:body.dailyLimitReached === true,
      bookingContractReady:body.aiBookingContractVersion === 1,
    };
  },

  async createBooking(context, input) {
    const token = await getBlackAgentIdToken(context.did, context.ownerId);
    let response: Response;
    try {
      response = await blackCallCenterFetch("/api/call-center/bookings",token,{
        method:"POST",tenantId:context.ownerId,signal:AbortSignal.timeout(25000),
        headers:{"Content-Type":"application/json","Idempotency-Key":input.idempotencyKey},
        body:JSON.stringify({ownerUid:context.ownerId,branchId:context.branchId,date:input.date,time:input.time,
          services:input.serviceIds.map(serviceId => ({serviceId})),client:input.customerName,
          clientEmail:input.customerEmail,clientPhone:input.customerPhone,vehicleNumber:input.vehicleNumber || "",
          vehicleType:input.vehicleType,notes:input.notes || "",source:"ai_reception"}),
      });
    } catch { return {status:"UNKNOWN",message:"The booking result is unknown. Retry with the same details or transfer to staff; do not claim it was saved."}; }
    const body = record(await response.json().catch(() => null));
    if (response.status === 202 || body.status === "PROCESSING") return {status:"PROCESSING",message:"The request is still processing. Retry with the same details or transfer to staff; do not claim a booking was saved."};
    if (response.status === 409) return {status:"CONFLICT",message:"The request could not be submitted because availability or request details changed. Check availability again or transfer to staff."};
    if (!response.ok) return {status:response.status >= 500 ? "UNKNOWN" : "REJECTED",message:"The request could not be verified. Transfer to staff; do not claim it was saved."};
    if (body.aiBookingContractVersion !== 1 || body.success !== true || typeof body.bookingId !== "string" || typeof body.bookingCode !== "string" || !["Pending","AwaitingStaffApproval","Confirmed"].includes(String(body.status))) return {status:"UNKNOWN",message:"The API returned an unexpected booking result. Ask staff to verify it before retrying."};
    const confirmed = body.status === "Confirmed";
    const staffAssignment = staffAssignmentResult(body.staffAssignment, confirmed);
    return {status:confirmed ? "CONFIRMED" : "PENDING_REVIEW",bookingId:body.bookingId,bookingCode:body.bookingCode,upstreamStatus:String(body.status),...(staffAssignment ? {staffAssignment} : {}),message:confirmed ? "The booking is confirmed and staff have been assigned." : "The booking request has been submitted for workshop review. Do not describe it as confirmed."};
  },
};
