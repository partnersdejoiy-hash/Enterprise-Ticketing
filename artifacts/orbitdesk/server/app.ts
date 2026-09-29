import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
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
