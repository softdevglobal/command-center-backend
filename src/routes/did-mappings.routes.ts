import { createClient, type User } from "@supabase/supabase-js";
import { Router, type Request, type Response } from "express";

import { roleMayRegisterAgents } from "../config/supabase-app-role.js";
import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../db/supabase/supabase.client.js";
import { sessionSummaryFromLocals } from "../services/auth/supabase-auth.service.js";
import {
  createDidMapping,
  deleteDidMapping,
  getDidMappingByDid,
  listDidMappings,
  updateDidMapping,
} from "../services/did-mappings.service.js";
import type {
  DIDMappingInput,
  DIDMappingUpdateInput,
} from "../types/did-mapping.types.js";

const router = Router();

type DidMappingsAuth =
  | { kind: "setup-secret" }
  | { kind: "bearer"; user: User; roles: string[] };

/**
 * Same contract as `POST /api/agents/register`: `x-setup-secret` when SETUP_SECRET_KEY is set,
 * or `Authorization: Bearer` as a super-admin user.
 */
async function authorizeDidMappingsRequest(
  req: Request,
  res: Response
): Promise<DidMappingsAuth | null> {
  const secret = req.headers["x-setup-secret"];
  const setupExpected = process.env.SETUP_SECRET_KEY?.trim();
  if (setupExpected && secret === setupExpected) {
    return { kind: "setup-secret" };
  }

  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    res.status(401).json({
      error:
        "Missing auth: send Authorization: Bearer <Supabase access_token> from POST /api/auth/login (super admin), OR header x-setup-secret matching SETUP_SECRET_KEY.",
    });
    return null;
  }

  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    res.status(500).json({
      error: "Supabase is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
    });
    return null;
  }

  try {
    const admin = createClient(url, key);
    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(token);

    if (userErr || !user) {
      res.status(401).json({
        error: userErr?.message ?? "Invalid or expired Supabase session.",
      });
      return null;
    }

    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (roleRows ?? [])
      .map((row: { role: string }) => row.role)
      .filter(Boolean);

    if (!roles.some((r) => roleMayRegisterAgents(r))) {
      res.status(403).json({
        error:
          "Only super admins may manage DID mappings. Ensure user_roles.role matches SUPABASE_SUPER_ADMIN_ROLE or super_admin / admin.",
      });
      return null;
    }

    return { kind: "bearer", user, roles };
  } catch {
    res.status(401).json({ error: "Invalid or expired Supabase session." });
    return null;
  }
}

function didFromParams(raw: string | string[] | undefined): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

/**
 * GET /api/did-mappings
 * Optional query: tenantId, queueId
 */
router.get("/", async (req, res) => {
  const auth = await authorizeDidMappingsRequest(req, res);
  if (!auth) return;

  const filters: { tenantId?: string; queueId?: string } = {};
  if (typeof req.query.tenantId === "string") filters.tenantId = req.query.tenantId;
  if (typeof req.query.queueId === "string") filters.queueId = req.query.queueId;

  try {
    const data = await listDidMappings(filters);
    const base = { success: true as const, data };
    if (auth.kind === "bearer") {
      res.json({
        ...base,
        authMode: "bearer" as const,
        authenticatedAs: sessionSummaryFromLocals({
          user: auth.user,
          roles: auth.roles,
        }),
      });
      return;
    }
    res.json({ ...base, authMode: "x-setup-secret" as const });
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
  const auth = await authorizeDidMappingsRequest(req, res);
  if (!auth) return;

  const did = didFromParams(req.params.did);
  try {
    const row = await getDidMappingByDid(did);
    if (!row) {
      res.status(404).json({ success: false, error: "DID mapping not found." });
      return;
    }
    const base = { success: true as const, data: row };
    if (auth.kind === "bearer") {
      res.json({
        ...base,
        authMode: "bearer" as const,
        authenticatedAs: sessionSummaryFromLocals({
          user: auth.user,
          roles: auth.roles,
        }),
      });
      return;
    }
    res.json({ ...base, authMode: "x-setup-secret" as const });
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
  const auth = await authorizeDidMappingsRequest(req, res);
  if (!auth) return;

  const body = req.body as DIDMappingInput;
  try {
    const data = await createDidMapping(body);
    const base = { success: true as const, data };
    if (auth.kind === "bearer") {
      res.status(201).json({
        ...base,
        authMode: "bearer" as const,
        authenticatedAs: sessionSummaryFromLocals({
          user: auth.user,
          roles: auth.roles,
        }),
      });
      return;
    }
    res.status(201).json({ ...base, authMode: "x-setup-secret" as const });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create mapping";
    const status =
      e instanceof Error &&
      "statusCode" in e &&
      typeof (e as Error & { statusCode?: number }).statusCode === "number"
        ? (e as Error & { statusCode: number }).statusCode
        : 400;
    res.status(status).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/did-mappings/:did
 * Body: one or more of { label, tenantId, queueId, ownerUid, workshopName, branchId, branchName }
 * `did` in the URL cannot be changed; `did` in the body is rejected if different.
 */
router.patch("/:did", async (req, res) => {
  const auth = await authorizeDidMappingsRequest(req, res);
  if (!auth) return;

  const did = didFromParams(req.params.did);
  const body = req.body as DIDMappingUpdateInput & { did?: string };

  if (
    body?.did !== undefined &&
    String(body.did).trim() !== did.trim()
  ) {
    res.status(400).json({
      success: false,
      error: "did cannot be changed — use the URL path for the existing DID.",
    });
    return;
  }

  try {
    const data = await updateDidMapping(did, body);
    const base = { success: true as const, data };
    if (auth.kind === "bearer") {
      res.json({
        ...base,
        authMode: "bearer" as const,
        authenticatedAs: sessionSummaryFromLocals({
          user: auth.user,
          roles: auth.roles,
        }),
      });
      return;
    }
    res.json({ ...base, authMode: "x-setup-secret" as const });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update mapping";
    const status =
      e instanceof Error &&
      "statusCode" in e &&
      typeof (e as Error & { statusCode?: number }).statusCode === "number"
        ? (e as Error & { statusCode: number }).statusCode
        : 400;
    res.status(status).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/did-mappings/:did
 * Encode `+` in E.164 DIDs (e.g. %2B61…) in the path.
 */
router.delete("/:did", async (req, res) => {
  const auth = await authorizeDidMappingsRequest(req, res);
  if (!auth) return;

  const did = didFromParams(req.params.did);
  try {
    const data = await deleteDidMapping(did);
    const base = { success: true as const, data };
    if (auth.kind === "bearer") {
      res.json({
        ...base,
        authMode: "bearer" as const,
        authenticatedAs: sessionSummaryFromLocals({
          user: auth.user,
          roles: auth.roles,
        }),
      });
      return;
    }
    res.json({ ...base, authMode: "x-setup-secret" as const });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete mapping";
    const status =
      e instanceof Error &&
      "statusCode" in e &&
      typeof (e as Error & { statusCode?: number }).statusCode === "number"
        ? (e as Error & { statusCode: number }).statusCode
        : 500;
    res.status(status).json({ success: false, error: msg });
  }
});

export default router;
