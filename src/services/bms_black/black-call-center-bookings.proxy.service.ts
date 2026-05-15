import { blackEndpoint } from "../../config/black-api.js";

const BLACK_BOOKINGS_PATH = "/api/call-center/bookings";

/**
 * Proxies to BMS Black `GET /api/call-center/bookings`.
 * `bearer` must be the **Firebase Black** ID token (same as `firebaseIdentityToolkit.idToken` from POST /api/auth/login).
 */
export async function proxyBlackCallCenterBookings(bearer: string): Promise<Response> {
  const token = bearer.replace(/^Bearer\s+/i, "").trim();
  const url = blackEndpoint(BLACK_BOOKINGS_PATH);
  return fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
}
