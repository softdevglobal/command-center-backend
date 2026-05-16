import "./dotenv-quiet-preflight.js";
import "./env-bootstrap.js";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import routes from "./routes/index.js";

const app = express();

app.use(cors());
if (process.env.DISABLE_HELMET === "true") {
  console.warn("[app] DISABLE_HELMET=true — helmet middleware skipped");
} else {
  app.use(helmet({ contentSecurityPolicy: false }));
}
app.use(morgan("dev"));
app.use(express.json());

app.use("/api", routes);

export default app;