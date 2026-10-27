import { Router } from "express";
import { requireSuperAdminOrSetup } from "../../middleware/super-admin-or-setup.middleware.js";
import {
  AiAgentSetupError, listBlackAiAgentOptions, provisionBlackAiAgent,
} from "../../services/ai/black-ai-agent-provisioning.service.js";
import { listTradeAiAgentOptions, provisionTradeAiAgent } from "../../services/ai/trade-ai-agent-provisioning.service.js";

const router = Router();
router.use(requireSuperAdminOrSetup);
router.use((_req, res, next) => {
  if (res.locals.superAdminAuth?.kind !== "bearer") {
    res.status(403).json({ error: "Sign in as a super admin to manage AI accounts." });
    return;
  }
  next();
});

router.get("/", async (req, res) => {
  const brand = req.query.brand ?? "black";
  if (brand !== "black" && brand !== "trade") { res.status(400).json({ error: "Choose Black or Trade." }); return; }
  try {
    res.json({ options: await (brand === "trade" ? listTradeAiAgentOptions() : listBlackAiAgentOptions()) });
  } catch (error) {
    console.error("[ai accounts] List failed", error);
    res.status(error instanceof AiAgentSetupError ? error.status : 500).json({
      error: error instanceof AiAgentSetupError ? error.message : "Could not load AI accounts. Check the backend connection and retry.",
    });
  }
});

router.post("/", async (req, res) => {
  const { did, name, brand = "black" } = req.body ?? {};
  if (brand !== "black" && brand !== "trade") { res.status(400).json({ error: "Choose Black or Trade." }); return; }
  if (typeof did !== "string" || !did.trim() || did.length > 64 ||
      typeof name !== "string" || !name.trim() || name.trim().length > 120) {
    res.status(400).json({ error: "Select a mapped phone number and enter a name of up to 120 characters." });
    return;
  }
  try {
    const result = await (brand === "trade" ? provisionTradeAiAgent : provisionBlackAiAgent)({
      did: did.trim(), name: name.trim(), createdBy: res.locals.superAdminAuth.user.id,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    console.error("[ai accounts] Creation failed", error);
    res.status(error instanceof AiAgentSetupError ? error.status : 500).json({
      error: error instanceof AiAgentSetupError ? error.message : `Could not create the AI account. Check Firebase ${brand === "trade" ? "Blue" : "Black"} on the backend and retry.`,
    });
  }
});

export default router;
