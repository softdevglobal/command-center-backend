import "./dotenv-quiet-preflight.js";
import "./env-bootstrap.js";

import { printStartupDatabaseStatus } from "./db/startup-status.js";
import app from "./app.js";

const PORT = Number(process.env.PORT) || 5050;
/** Bind IPv4 explicitly — on macOS, `localhost` often resolves to 127.0.0.1 while a default listen may only attach to IPv6, so Postman/curl to 127.0.0.1 would miss this server (or hit another listener like AirPlay on :5000). */
const HOST = (process.env.HOST ?? "0.0.0.0").trim() || "0.0.0.0";

await printStartupDatabaseStatus(PORT, HOST);

const postmanBase = `http://127.0.0.1:${PORT}`;

const server = app.listen(PORT, HOST, () => {
  console.log(`HTTP server listening on http://${HOST}:${PORT}`);
  console.log("");
  console.log("  >>> Use THIS port in Postman — NOT :5000 on macOS <<<");
  console.log("      (Port 5000 is AirPlay/ControlCenter and returns 403.)");
  console.log("");
  console.log("  --- Postman / local testing ---");
  console.log(`  GET  ${postmanBase}/api           (should return JSON with listen.port = ${PORT})`);
  console.log(`  POST ${postmanBase}/api/auth/login`);
  console.log("");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error("");
    console.error("============================================================");
    console.error(`  Port ${PORT} is already in use.`);
    if (PORT === 5000) {
      console.error("");
      console.error("  macOS owns :5000 by default (AirPlay / ControlCenter).");
      console.error("  Postman gets 403 because requests hit ControlCenter, not us.");
      console.error("");
      console.error("  Fix: set PORT=5050 in .env.local, then restart `npm run dev`.");
      console.error("  Or disable: System Settings → General → AirDrop & Handoff → AirPlay Receiver.");
    } else {
      console.error("  Stop the other process or change PORT in .env.local.");
    }
    console.error("============================================================");
    console.error("");
    process.exit(1);
  }
  throw err;
});