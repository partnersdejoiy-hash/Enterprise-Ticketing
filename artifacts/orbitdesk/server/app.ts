import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const staticPath = path.join(process.cwd(), "dist", "public");
  app.use(express.static(staticPath));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });
}

export default app;
