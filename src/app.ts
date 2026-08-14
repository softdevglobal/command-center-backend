import "./dotenv-quiet-preflight.js";
import "./env-bootstrap.js";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { getAllowedCorsOrigins } from "./config/cors.js";
import routes from "./routes/index.js";

const app = express();

const allowedOrigins = getAllowedCorsOrigins();
app.use(
  cors({
    origin(origin, callback) {
      // Non-browser clients (curl, Postman, server-to-server) send no Origin.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  })
);

if (process.env.DISABLE_HELMET === "true") {
  console.warn("[app] DISABLE_HELMET=true — helmet middleware skipped");
} else {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https://*.supabase.co", "wss://*.supabase.co"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "same-origin" },
    })
  );
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
    next();
  });
}

app.use(morgan("dev"));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

app.get("/.well-known/security.txt", (_req, res) => {
  const contact =
    process.env.SECURITY_CONTACT?.trim() || "mailto:security@bmspros.com.au";
  const canonical =
    process.env.SECURITY_TXT_CANONICAL?.trim() ||
    "https://commandcenter.bmspros.com.au/.well-known/security.txt";
  const expires =
    process.env.SECURITY_TXT_EXPIRES?.trim() || "2027-08-13T00:00:00Z";

  res
    .type("text/plain")
    .send(
      [
        `Contact: ${contact}`,
        "Preferred-Languages: en",
        `Canonical: ${canonical}`,
        `Expires: ${expires}`,
        "",
      ].join("\n")
    );
});

app.use("/api", routes);

export default app;
