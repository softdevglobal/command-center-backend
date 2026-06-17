import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";

import {
  attachSupabaseUser,
  type SupabaseAuthLocals,
} from "../../middleware/supabase-auth.middleware.js";
import { saveBlackAgentActivity } from "../../services/firestore/black-agent-activities.firestore.service.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
    fieldSize: 10 * 1024 * 1024,
    files: 1,
  },
});

const recordingUpload = upload.single("recording");

function parseRecordingUpload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  recordingUpload(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({
        ok: false,
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? "Recording upload is too large. Maximum allowed size is 100 MB."
            : err.message,
        code: err.code,
      });
      return;
    }

    const message =
      err instanceof Error ? err.message : "Failed to parse activity upload.";
    res.status(400).json({ ok: false, error: message });
  });
}

/**
 * POST /api/call-center/agent-activities
 * Saves Black queue agent activity metadata in Firestore. Optional multipart
 * field `recording` is uploaded to Firebase Storage first; Firestore receives
 * the final Storage URL/path, not the raw file.
 */
router.post(
  "/agent-activities",
  attachSupabaseUser,
  parseRecordingUpload,
  async (_req, res) => {
    const req = _req as Request & { file?: Express.Multer.File };
    const auth = res.locals.supabaseAuth as SupabaseAuthLocals | undefined;

    try {
      const activity = await saveBlackAgentActivity({
        fields: req.body as Record<string, unknown>,
        ...(req.file ? { recording: req.file } : {}),
        ...(auth?.user?.id
          ? { authenticatedSupabaseUserId: auth.user.id }
          : {}),
      });

      res.status(201).json({
        ok: true,
        activity,
      });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to save agent activity.";
      console.error(`[call-center agent-activities] ${msg}`);
      res.status(500).json({ ok: false, error: msg });
    }
  }
);

export default router;
