import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import {
  generalApiLimiter,
  aiApiLimiter,
  authApiLimiter,
} from "./lib/rate-limit.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

// ─── Security headers (Phase A) ───────────────────────────────────────────
// Helmet sets: CSP, HSTS (prod only), X-Frame-Options DENY,
// X-Content-Type-Options nosniff, Referrer-Policy, and more.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Vite + shadcn inject runtime styles; allow inline styles only.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // HSTS only in production — never send it over plain HTTP in dev.
    hsts:
      process.env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true, preload: false }
        : false,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "same-origin" },
  }),
);
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !req.path.startsWith("/api/integrations/") &&
    !req.path.startsWith("/api/webhooks/")
  ) {
    const origin = req.get("Origin");
    const allowed =
      process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
    if (origin && origin !== allowed) {
      res.status(403).json({ error: "Invalid request origin" });
      return;
    }
    if (!origin && req.headers.cookie) {
      res.status(403).json({ error: "Origin required" });
      return;
    }
  }
  next();
});
app.use(
  express.json({
    limit: "3mb",
    verify(req, _res, buf) {
      (req as any).rawBody = Buffer.from(buf);
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

// ─── API-wide rate limits (Phase A) ───────────────────────────────────────
// Order matters: tighter per-surface limits first, then the general guard.
// These run before authMiddleware, so keys are IP-based here (see
// lib/rate-limit.ts). The existing DB-backed per-endpoint limits
// (login, password reset) remain as the precise inner guard.
app.use("/api/ai", aiApiLimiter());
app.use("/api/auth", authApiLimiter());
app.use("/api", generalApiLimiter());

app.use("/api", router);

if (
  (process.env.NODE_ENV === "production" || process.env.STATIC_DIR) &&
  !process.env.VERCEL
) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const staticPath =
    process.env.STATIC_DIR ||
    path.resolve(process.cwd(), "artifacts/orbitdesk/dist/public");
  app.use(express.static(staticPath));
  app.get("/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    err?.type === "entity.too.large"
      ? 413
      : err instanceof SyntaxError
        ? 400
        : 500;
  res
    .status(status)
    .json({
      error:
        status === 500
          ? "Service unavailable. Please try again."
          : "Invalid request body",
    });
});
export default app;
