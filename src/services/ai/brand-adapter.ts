/** Trusted tenant context resolved by the server from the Yeastar credential -> DID map. */
export type FrontOfficeTenantContext = {
  did: string;
  tenantId: string;
  ownerId: string;
  branchId: string;
  branchName: string | null;
  workshopName: string | null;
};

export type FrontOfficeBrand = "black";

/**
 * Brand adapters normalize their source-of-truth workflow. Black uses drop-off
 * requests and staff approval, not exclusive mechanic appointment reservations.
 */
export interface FrontOfficeBrandAdapter {
  readonly brand: FrontOfficeBrand;
  getBranch(context: FrontOfficeTenantContext): Promise<unknown>;
  listServices(context: FrontOfficeTenantContext): Promise<unknown[]>;
  getAvailableSlots(context: FrontOfficeTenantContext, query: {date:string;serviceIds:string[]}): Promise<FrontOfficeAvailability>;
  createBooking(context: FrontOfficeTenantContext, input: FrontOfficeBookingInput): Promise<FrontOfficeBookingResult>;
}

export type FrontOfficeAvailability = {
  date: string;
  timeZone: string;
  availableSlots: string[];
  dailyLimitReached: boolean;
  bookingContractReady: boolean;
};
export type FrontOfficeBookingInput = {
  date:string; time:string; serviceIds:string[]; idempotencyKey:string;
  customerName:string; customerEmail:string; customerPhone:string;
  vehicleNumber?:string | undefined; notes?:string | undefined;
  vehicleType?:"small_car"|"sedan_wagon"|"suv"|"ute_van_4wd"|"performance_large"|undefined;
};
export type FrontOfficeBookingResult = {
  status:"PENDING_REVIEW"|"PROCESSING"|"CONFLICT"|"REJECTED"|"UNKNOWN";
  bookingId?:string; bookingCode?:string; upstreamStatus?:string;
  message:string;
};
