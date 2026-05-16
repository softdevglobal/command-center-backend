/**
 * Load env from the project root (next to `package.json`), not from `process.cwd()`.
 *
 * Order: optional `.env` (defaults) → `.env.local` overrides (local secrets — use this file on your machine).
 * Missing files are skipped. `quiet: true` avoids dotenv v17 “◇ injected env …” console noise.
 *
 * Tip: set `DOTENV_CONFIG_QUIET=true` in `npm run dev` so other loaders (e.g. tsx) stay quiet too.
 */
import { existsSync } from "fs";
import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const envPath = resolve(root, ".env");
const envLocalPath = resolve(root, ".env.local");

const quiet = true;

if (existsSync(envPath)) {
  config({ path: envPath, quiet });
}
if (existsSync(envLocalPath)) {
  config({ path: envLocalPath, override: true, quiet });
}
