import {
  pinkCallCenterFetch,
  pinkJsonInit,
  withQuery,
} from "./pink-call-center.proxy.util.js";

const PINK_BOOKINGS_PATH = "/api/call-center/bookings";

function bookingByIdPath(bookingId: string): string {
  return `${PINK_BOOKINGS_PATH}/${encodeURIComponent(bookingId.trim())}`;
}

/** `GET /api/call-center/bookings` — all salons the caller can see (tenant optional). */
export async function proxyPinkCallCenterBookings(
  firebaseIdToken: string,
  query: Record<string, string | undefined>,
  tenantId?: string
): Promise<Response> {
  const init: RequestInit & { tenantId?: string } = { method: "GET" };
  if (tenantId) init.tenantId = tenantId;
  return pinkCallCenterFetch(withQuery(PINK_BOOKINGS_PATH, query), firebaseIdToken, init);
}

/** `GET /api/call-center/bookings/availability` */
export async function proxyPinkCallCenterBookingAvailability(
  firebaseIdToken: string,
  tenantId: string,
  query: Record<string, string | undefined>
): Promise<Response> {
  return pinkCallCenterFetch(
    withQuery(`${PINK_BOOKINGS_PATH}/availability`, query),
    firebaseIdToken,
    { method: "GET", tenantId, signal: AbortSignal.timeout(15000) }
  );
}

/** `POST /api/call-center/bookings` */
export async function proxyPinkCallCenterCreateBooking(
  firebaseIdToken: string,
  tenantId: string,
  body: unknown
): Promise<Response> {
  return pinkCallCenterFetch(PINK_BOOKINGS_PATH, firebaseIdToken, {
    ...pinkJsonInit("POST", body),
    tenantId,
  });
}

/** `GET /api/call-center/bookings/:bookingId` */
export async function proxyPinkCallCenterBookingById(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string
): Promise<Response> {
  return pinkCallCenterFetch(bookingByIdPath(bookingId), firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/** `PATCH /api/call-center/bookings/:bookingId` — `{ status: Confirmed | Canceled | Completed }`. */
export async function proxyPinkCallCenterPatchBooking(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  body: unknown
): Promise<Response> {
  return pinkCallCenterFetch(bookingByIdPath(bookingId), firebaseIdToken, {
    ...pinkJsonInit("PATCH", body),
    tenantId,
  });
}

/** `POST /api/call-center/bookings/:bookingId/{confirm|cancel|complete}` */
export async function proxyPinkCallCenterBookingAction(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  action: "confirm" | "cancel" | "complete",
  body: unknown
): Promise<Response> {
  return pinkCallCenterFetch(`${bookingByIdPath(bookingId)}/${action}`, firebaseIdToken, {
    ...pinkJsonInit("POST", body),
    tenantId,
  });
}

/** `PATCH /api/call-center/bookings/:bookingId/reschedule` */
export async function proxyPinkCallCenterRescheduleBooking(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  body: unknown
): Promise<Response> {
  return pinkCallCenterFetch(`${bookingByIdPath(bookingId)}/reschedule`, firebaseIdToken, {
    ...pinkJsonInit("PATCH", body),
    tenantId,
  });
}
