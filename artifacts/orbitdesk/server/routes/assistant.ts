import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.js";
import { db, departmentsTable } from "@workspace/db";
import { classifyTeam } from "../lib/team-classifier.js";
const router = Router();
router.post("/assistant/team-suggestion", authMiddleware, async (req, res) => {
  if (
    typeof req.body?.text !== "string" ||
    req.body.text.trim().length < 3 ||
    req.body.text.length > 2000
  ) {
    res.status(400).json({ error: "Describe the issue in 3–2000 characters" });
    return;
  }
  const teams = await db.select().from(departmentsTable);
  const suggestion = classifyTeam(req.body.text, teams);
  res.json({
    ...suggestion,
    departmentName:
      teams.find((t) => t.id === suggestion.departmentId)?.name ?? null,
    method: "local-tfidf",
    changesApplied: false,
  });
});
export default router;
