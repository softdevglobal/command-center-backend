import { Router } from "express";
import { requireSuperAdminOrSetup } from "../../middleware/super-admin-or-setup.middleware.js";
import { AiAgentSetupError } from "../../services/ai/ai-agent-provisioning.shared.js";
import {
  listPinkAiAgentOptions,
  listPinkWorkshopOptions,
  provisionPinkAiAgent,
} from "../../services/bms_pink/pink-ai-agent-provisioning.service.js";

const router = Router();
router.use(requireSuperAdminOrSetup);
router.use((_req, res, next) => {
  if (res.locals.superAdminAuth?.kind !== "bearer") {
    res.status(403).json({ error: "Sign in as a super admin to manage Pink AI receptionists." });
    return;
  }
  next();
});

/** Salon/branch options used by the Command Center DID mapping form. */
router.get("/salons", async (_req, res) => {
  try { res.json({ options: await listPinkWorkshopOptions() }); }
  catch (error) {
    console.error("[Pink AI reception] Salon list failed", error);
    res.status(error instanceof AiAgentSetupError ? error.status : 500).json({
      error: error instanceof AiAgentSetupError ? error.message : "Could not load Pink salons.",
    });
  }
});

/** List Pink DID mappings and their account state. */
router.get("/", async (_req, res) => {
  try { res.json({ options: await listPinkAiAgentOptions() }); }
  catch (error) {
    console.error("[Pink AI reception] Account list failed", error);
    res.status(error instanceof AiAgentSetupError ? error.status : 500).json({
      error: error instanceof AiAgentSetupError ? error.message : "Could not load Pink AI accounts.",
    });
  }
});

/** Provision or return the dedicated Pink Firebase receptionist for a mapped DID. */
router.post("/", async (req, res) => {
  const { did, name } = req.body ?? {};
  if (typeof did !== "string" || !did.trim() || did.length > 64 ||
      typeof name !== "string" || !name.trim() || name.trim().length > 120) {
    res.status(400).json({ error: "Select a mapped phone number and enter a name of up to 120 characters." });
    return;
  }
  try {
    const result = await provisionPinkAiAgent({
      did: did.trim(), name: name.trim(), createdBy: res.locals.superAdminAuth.user.id,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    console.error("[Pink AI reception] Account creation failed", error);
    res.status(error instanceof AiAgentSetupError ? error.status : 500).json({
      error: error instanceof AiAgentSetupError ? error.message : "Could not create the Pink AI account. Check Firebase Pink and retry.",
    });
  }
});

export default router;
