import { Router } from "express";
import { requireSuperAdminOrSetup } from "../../middleware/super-admin-or-setup.middleware.js";
import { availablePinkPlans } from "../../services/bms_pink/pink-onboarding.service.js";
import { OnboardingError } from "../../services/ai/onboarding.service.js";

const router = Router();
router.use(requireSuperAdminOrSetup);
router.get("/plans", async (_req, res) => {
  if (res.locals.superAdminAuth?.kind !== "bearer") {
    res.status(403).json({ error: "Sign in as a super admin to read Pink signup options." }); return;
  }
  try { res.json({ plans: await availablePinkPlans() }); }
  catch (error) {
    res.status(error instanceof OnboardingError ? error.status : 503).json({ error: "Pink signup plans could not be loaded." });
  }
});
export default router;
