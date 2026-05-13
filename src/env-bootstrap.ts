/**
 * Load `.env` from the project root (next to `package.json`), not from `process.cwd()`.
 * Fixes missing vars when the server is started from another directory or via tooling.
 */
import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

/** Local `.env` should win over empty/mistaken shell vars (e.g. SUPABASE_SUPER_ADMIN_ROLE=""). */
config({ path: resolve(here, "../.env"), override: true });
config({ path: resolve(here, "../.env.local"), override: true });
