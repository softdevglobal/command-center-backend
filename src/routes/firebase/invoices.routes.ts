import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import { getInvoiceById, listInvoices } from "../../services/invoices.service.js";

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
 * GET /api/invoices
 * All invoice documents from Firestore `invoices` (bmspro-trade).
 * Optional ?limit=&offset=
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
    const result = await listInvoices(options);
    res.json({
      success: true,
      ...result,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list invoices";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/invoices/:id
 * One invoice document from Firestore `invoices` (bmspro-trade).
 */
router.get("/:id", async (req, res) => {
  if (!res.locals.supabaseAuth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const id = paramId(req.params.id);
  if (!id) {
    res.status(400).json({ success: false, error: "Invoice id is required." });
    return;
  }

  try {
    const row = await getInvoiceById(id);
    if (!row) {
      res.status(404).json({ success: false, error: "Invoice not found." });
      return;
    }

    res.json({
      success: true,
      data: row,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load invoice";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
