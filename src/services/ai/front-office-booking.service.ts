import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FrontOfficeBrandAdapter, FrontOfficeTenantContext, FrontOfficeBookingResult } from "./brand-adapter.js";

const ids = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).min(1).max(10)
  .refine(items => new Set(items).size === items.length, "Service IDs must be unique.");
export const availabilityArguments = z.object({
  date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Requested calendar date YYYY-MM-DD in the workshop timezone."),
  serviceIds:ids.describe("Service IDs returned by list_services; ask the caller to select the service first."),
});
export const bookingArguments = z.object({
  slotToken:z.string().uuid().describe("An unexpired slotToken returned by get_available_slots in this session."),
  customerConfirmed:z.literal(true).describe("Set true only after reading back the service, branch, date, local drop-off time and customer details and receiving the caller's explicit confirmation."),
  customerName:z.string().trim().min(1).max(120),
  customerEmail:z.string().trim().email().max(254),
  customerPhone:z.string().trim().min(6).max(30).regex(/^[+\d][\d\s\-()]+$/).refine(phone => {const count=phone.replace(/\D/g, "").length;return count>=6 && count<=15;},"A valid customer phone number is required."),
  vehicleNumber:z.string().trim().max(30).optional(),
  vehicleType:z.enum(["small_car","sedan_wagon","suv","ute_van_4wd","performance_large"]).optional().describe("Ask the caller for their vehicle category when selected services have vehicleTypePricing. Never guess the category or price."),
  notes:z.string().trim().max(500).optional(),
});
type Offer = {context:FrontOfficeTenantContext;date:string;time:string;timeZone:string;serviceIds:string[];expiresAt:number};
type Decision = {status:string;message:string};
function scoped(a:FrontOfficeTenantContext,b:FrontOfficeTenantContext) {
  return a.did===b.did && a.tenantId===b.tenantId && a.ownerId===b.ownerId && a.branchId===b.branchId;
}
export function localCalendar(now:Date,timeZone:string) {
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const part=(type:string)=>parts.find(item=>item.type===type)?.value || "";
  return {date:`${part("year")}-${part("month")}-${part("day")}`,time:`${part("hour")}:${part("minute")}`};
}

/** Per-MCP-session offers. Tenant, branch, time and services are server resolved. */
export function createFrontOfficeBookingTools(adapter:FrontOfficeBrandAdapter, resolveTenant:()=>Promise<FrontOfficeTenantContext>, now:()=>Date=()=>new Date(), writesEnabled:()=>boolean=()=>process.env.AI_MCP_BOOKINGS_ENABLED==="true") {
  const offers=new Map<string,Offer>();
  const completed=new Map<string,{hash:string;result:FrontOfficeBookingResult}>();
  const pending=new Map<string,Promise<FrontOfficeBookingResult>>();
  return {
    async getAvailableSlots(raw:unknown) {
      const query=availabilityArguments.parse(raw);
      const parsed=new Date(`${query.date}T00:00:00Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==query.date) throw new Error("Use a valid calendar date.");
      const context=await resolveTenant();
      const services=await adapter.listServices(context);
      const allowed=new Set(services.map(service => (service as Record<string,unknown>).id));
      if(query.serviceIds.some(id=>!allowed.has(id))) throw new Error("Select only services offered by this workshop branch.");
      const available=await adapter.getAvailableSlots(context,query);
      const calendar=localCalendar(now(),available.timeZone);
      const lastDate=new Date(Date.parse(`${calendar.date}T00:00:00Z`)+90*86400000).toISOString().slice(0,10);
      if(query.date<calendar.date || query.date>lastDate) throw new Error("Request a date within the next 90 days in the workshop timezone.");
      for(const [token,offer] of offers) if(offer.expiresAt<=now().getTime()) offers.delete(token);
      const expiresAt=now().getTime()+10*60*1000;
      const slots=available.availableSlots.filter(time=>query.date!==calendar.date || time>calendar.time).map(time=>{
        const slotToken=randomUUID();
        offers.set(slotToken,{context:{...context},date:query.date,time,timeZone:available.timeZone,serviceIds:[...query.serviceIds].sort(),expiresAt});
        return {time,slotToken,expiresAt:new Date(expiresAt).toISOString()};
      });
      while(offers.size>256){const token=offers.keys().next().value;if(token)offers.delete(token);}
      return {brand:adapter.brand,workshopName:context.workshopName,branchName:context.branchName,
        date:query.date,timeZone:available.timeZone,slotType:"DROP_OFF",bookingWorkflow:"WORKSHOP_PERMISSION",
        dailyLimitReached:available.dailyLimitReached,slots,
        message:slots.length?"These are drop-off options based on branch hours and the daily booking limit. The workshop's permission determines whether Sophie can confirm the booking; only a CONFIRMED creation result means it is confirmed. No mechanic or time slot is reserved before creation.":"No drop-off options remain for this date. Ask for another date or transfer to staff."};
    },
    async createBooking(raw:unknown):Promise<FrontOfficeBookingResult|Decision> {
      const input=bookingArguments.parse(raw);
      if(!writesEnabled()) return {status:"DISABLED",message:"AI booking writes are disabled. Transfer the booking request to staff."};
      const context=await resolveTenant();
      const offer=offers.get(input.slotToken);
      if(!offer || !scoped(offer.context,context)) return {status:"INVALID_SLOT",message:"This drop-off offer does not belong to the current workshop/session. Check availability again."};
      const customerEmail=input.customerEmail.toLowerCase();
      const customerPhone=input.customerPhone.replace(/[\s\-()]/g, "");
      const vehicleNumber=input.vehicleNumber?.toUpperCase();
      const idempotencyKey=createHash("sha256").update(JSON.stringify({owner:context.ownerId,branch:context.branchId,date:offer.date,time:offer.time,services:offer.serviceIds,customerEmail,customerPhone,vehicleNumber:vehicleNumber || "",vehicleType:input.vehicleType || ""})).digest("hex");
      const booking={date:offer.date,time:offer.time,serviceIds:offer.serviceIds,idempotencyKey,customerName:input.customerName,customerEmail,customerPhone,vehicleNumber:vehicleNumber || "",vehicleType:input.vehicleType,notes:input.notes || ""};
      const hash=createHash("sha256").update(JSON.stringify(booking)).digest("hex");
      const existing=completed.get(idempotencyKey);
      if(existing){
        if(existing.hash!==hash) return {status:"CONFLICT",message:"The same request already has different customer details. Ask staff to review it."};
        return existing.result;
      }
      if(offer.expiresAt<=now().getTime()) return {status:"EXPIRED_SLOT",message:"This drop-off offer expired. Check availability again before taking confirmation."};
      const inFlight=pending.get(hash);
      if(inFlight)return inFlight;
      const attempt=(async()=>{
        // Do not reject a full day here: a retry may already be saved upstream.
        const live=await adapter.getAvailableSlots(context,{date:offer.date,serviceIds:offer.serviceIds});
        if(!live.bookingContractReady) return {status:"REJECTED" as const,message:"Black's safe AI booking contract is not deployed. Transfer to staff."};
        const result=await adapter.createBooking(context,booking);
        if(result.status==="PENDING_REVIEW" || result.status==="CONFIRMED") completed.set(idempotencyKey,{hash,result});
        return result;
      })().finally(()=>pending.delete(hash));
      pending.set(hash,attempt);
      return attempt;
    },
  };
}
