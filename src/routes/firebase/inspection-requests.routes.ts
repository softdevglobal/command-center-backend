import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import {
  createInspectionRequest,
  getInspectionRequestById,
  listInspectionRequestsByBusinessId,
  listInspectionRequests,
} from "../../services/inspection-requests.service.js";
import type { InspectionRequestCreateInput } from "../../types/inspection-request.types.js";

const router = Router();

router.use(attachSupabaseUser);

function queryInt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function paramId(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorStatus(e: unknown, fallback = 500): number {
  return e instanceof Error &&
    "statusCode" in e &&
    typeof (e as Error & { statusCode?: number }).statusCode === "number"
    ? (e as Error & { statusCode: number }).statusCode
    : fallback;
}

function authExtras(res: import("express").Response) {
  const auth = res.locals.supabaseAuth;
  if (!auth) return {};
  return {
    authenticatedAs: sessionSummaryFromLocals({
      user: auth.user,
      roles: auth.roles,
    }),
  };
}

/**
 * GET /api/inspection-requests
 * All documents from Firestore `inspection_requests` (bmspro-trade). Optional ?limit=&offset=
 */
router.get("/", async (req, res) => {
  if (!res.locals.supabaseAuth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const limit = queryInt(req.query.limit);
  const offset = queryInt(req.query.offset);
  const options: { limit?: number; offset?: number } = {};
  if (limit !== undefined) options.limit = limit;
  if (offset !== undefined) options.offset = offset;

  try {
    const result = await listInspectionRequests(options);
    res.json({
      success: true,
      ...result,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to list inspection requests";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/inspection-requests
 * Create a Firestore `inspection_requests` document with auto-generated id/timestamps.
 */
router.post("/", async (req, res) => {
  if (!res.locals.supabaseAuth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  if (!isRecord(req.body)) {
    res.status(400).json({ success: false, error: "JSON object body is required." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(body, "id")) {
    res.status(400).json({
      success: false,
      error: "id is generated automatically. Do not send id.",
    });
    return;
  }

  try {
    const data = await createInspectionRequest(
      body as InspectionRequestCreateInput
    );
    res.status(201).json({
      success: true,
      data,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to create inspection request";
    res.status(errorStatus(e, 400)).json({ success: false, error: msg });
  }
});

/**
 * GET /api/inspection-requests/businesses/:businessId
 * Inspection requests for one business id from Firestore `inspection_requests`.
 * Optional ?limit=&offset=
 */
router.get("/businesses/:businessId", async (req, res) => {
  if (!res.locals.supabaseAuth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const businessId = paramId(req.params.businessId);
  if (!businessId) {
    res.status(400).json({ success: false, error: "Business id is required." });
    return;
  }

  const limit = queryInt(req.query.limit);
  const offset = queryInt(req.query.offset);
  const options: { limit?: number; offset?: number } = {};
  if (limit !== undefined) options.limit = limit;
  if (offset !== undefined) options.offset = offset;

  try {
    const result = await listInspectionRequestsByBusinessId(
      businessId,
      options
    );
    res.json({
      success: true,
      businessId,
      ...result,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to list business inspection requests";
    res.status(errorStatus(e, 500)).json({ success: false, error: msg });
  }
});

/**
 * POST /api/inspection-requests/businesses/:businessId
 * Create a Firestore `inspection_requests` document for one business id.
 */
router.post("/businesses/:businessId", async (req, res) => {
  if (!res.locals.supabaseAuth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const businessId = paramId(req.params.businessId);
  if (!businessId) {
    res.status(400).json({ success: false, error: "Business id is required." });
    return;
  }

  if (!isRecord(req.body)) {
    res.status(400).json({ success: false, error: "JSON object body is required." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(body, "id")) {
    res.status(400).json({
      success: false,
      error: "id is generated automatically. Do not send id.",
    });
    return;
  }

  if (
    body.businessId !== undefined &&
    body.businessId !== null &&
    (typeof body.businessId !== "string" || body.businessId.trim() !== businessId)
  ) {
    res.status(400).json({
      success: false,
      error: "businessId in body must match the URL business id.",
    });
    return;
  }

  try {
    const data = await createInspectionRequest({
      ...body,
      businessId,
    } as InspectionRequestCreateInput);
    res.status(201).json({
      success: true,
      businessId,
      data,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to create inspection request";
    res.status(errorStatus(e, 400)).json({ success: false, error: msg });
  }
});

/**
 * GET /api/inspection-requests/:id
 */
router.get("/:id", async (req, res) => {
  if (!res.locals.supabaseAuth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const id = paramId(req.params.id);
  if (!id) {
    res.status(400).json({ success: false, error: "Inspection request id is required." });
    return;
  }

  try {
    const row = await getInspectionRequestById(id);
    if (!row) {
      res.status(404).json({ success: false, error: "Inspection request not found." });
      return;
    }

    res.json({
      success: true,
      data: row,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to load inspection request";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
