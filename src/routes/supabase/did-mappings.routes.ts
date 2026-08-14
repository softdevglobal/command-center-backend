import { Router } from "express";

import {
  authorizeSuperAdminOrSetup,
  type SuperAdminOrSetupAuth,
} from "../../middleware/super-admin-or-setup.middleware.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import {
  createDidMapping,
  deleteDidMapping,
  getDidMappingByDid,
  listDidMappings,
  updateDidMapping,
} from "../../services/did-mappings.service.js";
import type {
  DIDMappingInput,
  DIDMappingUpdateInput,
} from "../../types/did-mapping.types.js";

const router = Router();

function authEnvelope(auth: SuperAdminOrSetupAuth): Record<string, unknown> {
  if (auth.kind === "setup-secret") {
    return { authMode: "setup" as const };
  }
  return {
    authMode: "bearer" as const,
    authenticatedAs: sessionSummaryFromLocals({
      user: auth.user,
      roles: auth.roles,
    }),
  };
}

function didFromParams(raw: string | string[] | undefined): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

function statusFromError(e: unknown, fallback: number): number {
  if (
    e instanceof Error &&
    "statusCode" in e &&
    typeof (e as Error & { statusCode?: number }).statusCode === "number"
  ) {
    return (e as Error & { statusCode: number }).statusCode;
  }
  return fallback;
}

/**
 * GET /api/did-mappings
 * Optional query: tenantId, queueId
 */
router.get("/", async (req, res) => {
  const auth = await authorizeSuperAdminOrSetup(req, res);
  if (!auth) return;

  const filters: { tenantId?: string; queueId?: string } = {};
  if (typeof req.query.tenantId === "string") filters.tenantId = req.query.tenantId;
  if (typeof req.query.queueId === "string") filters.queueId = req.query.queueId;

  try {
    const data = await listDidMappings(filters);
    res.json({ success: true, data, ...authEnvelope(auth) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list DID mappings";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/did-mappings/:did
 * Encode `+` in E.164 DIDs (e.g. %2B61…) in the path.
 */
router.get("/:did", async (req, res) => {
  const auth = await authorizeSuperAdminOrSetup(req, res);
  if (!auth) return;

  const did = didFromParams(req.params.did);
  try {
    const row = await getDidMappingByDid(did);
    if (!row) {
      res.status(404).json({ success: false, error: "DID mapping not found." });
      return;
    }
    res.json({ success: true, data: row, ...authEnvelope(auth) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load DID mapping";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/did-mappings
 * Body: { did, label, tenantId, queueId, ownerUid, workshopName, branchId, branchName }
 */
router.post("/", async (req, res) => {
  const auth = await authorizeSuperAdminOrSetup(req, res);
  if (!auth) return;

  const body = req.body as DIDMappingInput;
  try {
    const data = await createDidMapping(body);
    res.status(201).json({ success: true, data, ...authEnvelope(auth) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create mapping";
    res.status(statusFromError(e, 400)).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/did-mappings/:did
 * Body: one or more of { label, tenantId, queueId, ownerUid, workshopName, branchId, branchName }
 * `did` in the URL cannot be changed; `did` in the body is rejected if different.
 */
router.patch("/:did", async (req, res) => {
  const auth = await authorizeSuperAdminOrSetup(req, res);
  if (!auth) return;

  const did = didFromParams(req.params.did);
  const body = req.body as DIDMappingUpdateInput & { did?: string };

  if (body?.did !== undefined && String(body.did).trim() !== did.trim()) {
    res.status(400).json({
      success: false,
      error: "did cannot be changed — use the URL path for the existing DID.",
    });
    return;
  }

  try {
    const data = await updateDidMapping(did, body);
    res.json({ success: true, data, ...authEnvelope(auth) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update mapping";
    res.status(statusFromError(e, 400)).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/did-mappings/:did
 * Encode `+` in E.164 DIDs (e.g. %2B61…) in the path.
 */
router.delete("/:did", async (req, res) => {
  const auth = await authorizeSuperAdminOrSetup(req, res);
  if (!auth) return;

  const did = didFromParams(req.params.did);
  try {
    const data = await deleteDidMapping(did);
    res.json({ success: true, data, ...authEnvelope(auth) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete mapping";
    res.status(statusFromError(e, 500)).json({ success: false, error: msg });
  }
});

export default router;
