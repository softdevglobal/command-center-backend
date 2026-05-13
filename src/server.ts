import "dotenv/config";

import { printStartupDatabaseStatus } from "./db/startup-status.js";
import app from "./app.js";

const PORT = Number(process.env.PORT) || 5000;

await printStartupDatabaseStatus(PORT);

app.listen(PORT, () => {
  console.log(`HTTP server listening on http://127.0.0.1:${PORT}`);
});