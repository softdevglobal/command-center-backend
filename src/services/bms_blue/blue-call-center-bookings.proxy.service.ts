import {
  blueCallCenterFetch,
  blueGetInit,
  blueJsonInit,
  withQuery,
} from "./blue-call-center.proxy.util.js";

/**
 * BMS Trade call-center bookings = inspection requests.
 * Upstream: `{BLUE_API_BASE_URL}/api/call-center/bookings/*`, scoped by `X-Tenant-Id` (businessId).
 */
const BLUE_BOOKINGS_PATH = "/api/call-center/bookings";

function bookingByIdPath(bookingId: string): string {
  return `${BLUE_BOOKINGS_PATH}/${encodeURIComponent(bookingId.trim())}`;
}

/** `GET /api/call-center/bookings` — tenant optional (without it: every assigned business). */
export async function proxyBlueCallCenterBookings(
  firebaseIdToken: string,
  query: Record<string, string | undefined>,
  tenantId?: string
): Promise<Response> {
  return blueCallCenterFetch(withQuery(BLUE_BOOKINGS_PATH, query), firebaseIdToken, blueGetInit(tenantId));
}

/** `GET /api/call-center/bookings/availability?from=&to=` */
export async function proxyBlueCallCenterBookingAvailability(
  firebaseIdToken: string,
  tenantId: string,
  query: Record<string, string | undefined>
): Promise<Response> {
  return blueCallCenterFetch(withQuery(`${BLUE_BOOKINGS_PATH}/availability`, query), firebaseIdToken, {
    ...blueGetInit(tenantId),
    signal: AbortSignal.timeout(15000),
  });
}

/** `POST /api/call-center/bookings` — creates an inspection request. */
export async function proxyBlueCallCenterCreateBooking(
  firebaseIdToken: string,
  tenantId: string,
  body: unknown
): Promise<Response> {
  return blueCallCenterFetch(BLUE_BOOKINGS_PATH, firebaseIdToken, blueJsonInit("POST", body, tenantId));
}

/** `GET /api/call-center/bookings/:id` — id or request code. */
export async function proxyBlueCallCenterBookingById(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string
): Promise<Response> {
  return blueCallCenterFetch(bookingByIdPath(bookingId), firebaseIdToken, blueGetInit(tenantId));
}

/** `POST /api/call-center/bookings/:id/{confirm|cancel|complete}` */
export async function proxyBlueCallCenterBookingAction(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  action: "confirm" | "cancel" | "complete",
  body: unknown
): Promise<Response> {
  return blueCallCenterFetch(
    `${bookingByIdPath(bookingId)}/${action}`,
    firebaseIdToken,
    blueJsonInit("POST", body, tenantId)
  );
}

/** `PATCH /api/call-center/bookings/:id` — `{ status, ... }`. */
export async function proxyBlueCallCenterPatchBooking(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  body: unknown
): Promise<Response> {
  return blueCallCenterFetch(bookingByIdPath(bookingId), firebaseIdToken, blueJsonInit("PATCH", body, tenantId));
}

/** `PATCH /api/call-center/bookings/:id/reschedule` */
export async function proxyBlueCallCenterRescheduleBooking(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  body: unknown
): Promise<Response> {
  return blueCallCenterFetch(
    `${bookingByIdPath(bookingId)}/reschedule`,
    firebaseIdToken,
    blueJsonInit("PATCH", body, tenantId)
  );
}
