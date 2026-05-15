import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";

const BLACK_BOOKINGS_PATH = "/api/call-center/bookings";

/** `GET /api/call-center/bookings` */
export async function proxyBlackCallCenterBookings(
  firebaseIdToken: string
): Promise<Response> {
  return blackCallCenterFetch(BLACK_BOOKINGS_PATH, firebaseIdToken, {
    method: "GET",
  });
}

/** `GET /api/call-center/bookings/availability` */
export async function proxyBlackCallCenterBookingAvailability(
  firebaseIdToken: string,
  tenantId: string,
  query: { branchId: string; date: string; serviceIds: string }
): Promise<Response> {
  const path = `${BLACK_BOOKINGS_PATH}/availability?branchId=${encodeURIComponent(query.branchId)}&date=${encodeURIComponent(query.date)}&serviceIds=${encodeURIComponent(query.serviceIds)}`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/** `POST /api/call-center/bookings` */
export async function proxyBlackCallCenterCreateBooking(
  firebaseIdToken: string,
  body: unknown
): Promise<Response> {
  return blackCallCenterFetch(BLACK_BOOKINGS_PATH, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** `GET /api/call-center/bookings/:bookingId` */
export async function proxyBlackCallCenterBookingById(
  firebaseIdToken: string,
  bookingId: string
): Promise<Response> {
  const path = `${BLACK_BOOKINGS_PATH}/${encodeURIComponent(bookingId.trim())}`;
  return blackCallCenterFetch(path, firebaseIdToken, { method: "GET" });
}

/** `PATCH /api/call-center/bookings/:bookingId` */
export async function proxyBlackCallCenterPatchBooking(
  firebaseIdToken: string,
  bookingId: string,
  body: unknown
): Promise<Response> {
  const path = `${BLACK_BOOKINGS_PATH}/${encodeURIComponent(bookingId.trim())}`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** `POST /api/call-center/bookings/:bookingId/confirm` */
export async function proxyBlackCallCenterConfirmBooking(
  firebaseIdToken: string,
  bookingId: string,
  body: unknown
): Promise<Response> {
  const path = `${BLACK_BOOKINGS_PATH}/${encodeURIComponent(bookingId.trim())}/confirm`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
