import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import type { SupabaseAuthLocals } from "../../middleware/supabase-auth.middleware.js";
import { getFirebaseIdTokenForSupabaseUser } from "../../services/auth/firebase-black-login.store.js";
import { proxyBlackCallCenterBookings } from "../../services/bms_black/black-call-center-bookings.proxy.service.js";

const router = Router();

/**
 * GET /api/bms-black/getallbooking
 *
 * **Frontend:** `Authorization: Bearer <Supabase access_token>` from `POST /api/auth/login`.
 * **Upstream Black:** this server forwards `Authorization: Bearer <stored Firebase idToken>`
 * for the same Supabase user (saved at login when Identity Toolkit succeeds).
 */
router.get("/getallbooking", attachSupabaseUser, async (_req, res) => {
  const auth = res.locals.supabaseAuth as SupabaseAuthLocals | undefined;
  const supabaseUserId = auth?.user?.id;
  if (!supabaseUserId) {
    res.status(401).json({ error: "Missing Supabase session." });
    return;
  }

  const firebaseIdToken = getFirebaseIdTokenForSupabaseUser(supabaseUserId);
  if (!firebaseIdToken) {
    res.status(403).json({
      error:
        "No stored Firebase Black idToken for this user. Sign in again with POST /api/auth/login while FIREBASE_BLACK_WEB_API_KEY is set and Firebase accepts the same password.",
    });
    return;
  }

  let upstream: Response;
  try {
    upstream = await proxyBlackCallCenterBookings(firebaseIdToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upstream request failed";
    res.status(502).json({ success: false, error: msg });
    return;
  }

  const text = await upstream.text();
  const ct = upstream.headers.get("content-type") ?? "";
  res.status(upstream.status);
  if (ct.includes("application/json") && text.trim() !== "") {
    try {
      res.json(JSON.parse(text) as unknown);
    } catch {
      res.type("text/plain").send(text);
    }
  } else if (!text.trim()) {
    res.end();
  } else {
    res.type(ct || "text/plain").send(text);
  }
});

export default router;


