/**
 * Orbit Graph API (#2 + #16).
 *
 * Mounted at /api/graph (see routes/index.ts).
 * All endpoints require authentication; ticket nodes are permission-filtered
 * through canAccessTicket; relationship creation requires agent+ role.
 */

import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";
import { emitEvent, EventTypes } from "../lib/orbit-events.js";
import {
  getTicketGraph,
  createRelationship,
  deleteRelationship,
  suggestRelationships,
  TICKET_REL_TYPES,
} from "../lib/relationship-graph.js";
import {
  getEntityGraph,
  findSimilar,
  type EntityType,
} from "../lib/intelligence-graph.js";

const router = Router();
// Scoped to this router's own paths: a bare router.use(authMiddleware) here
// would gate EVERY /api/* request (this router is mounted at "/"), breaking
// public routes like /api/auth/login.
router.use(
  ["/tickets", "/relationships", "/relationship-types", "/entity", "/similar"],
  authMiddleware,
);

const STAFF_ROLES = ["super_admin", "admin", "manager", "agent"];

function requireStaff(req: AuthenticatedRequest) {
  return req.user && STAFF_ROLES.includes(req.user.role);
}

/** GET /api/graph/tickets/:id?depth=2 — ticket relationship graph (#2). */
router.get("/tickets/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const depth = Math.max(0, Math.min(3, Number(req.query.depth) || 2));
    const graph = await getTicketGraph(id, req.user!, depth);
    res.json({ ok: true, ...graph });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 400).json({ error: e.message ?? "Failed to load graph" });
  }
});

/** GET /api/graph/tickets/:id/suggestions — AI-suggested relationships. */
router.get("/tickets/:id/suggestions", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const suggestions = await suggestRelationships(id, req.user!);
    res.json({ ok: true, suggestions });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 400).json({ error: e.message ?? "Failed to load suggestions" });
  }
});

/** POST /api/graph/relationships — create a relationship (agent+). */
router.post("/relationships", async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireStaff(req)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const { source, target, type } = req.body ?? {};
    const sourceId = Number(source);
    const targetId = Number(target);
    if (!Number.isSafeInteger(sourceId) || !Number.isSafeInteger(targetId)) {
      res.status(400).json({ error: "source and target must be ticket ids" });
      return;
    }
    const id = await createRelationship({
      sourceId,
      targetId,
      type: String(type ?? "related_to"),
      userId: req.user!.id,
    });
    await emitEvent({
      type: EventTypes.TICKET_UPDATED,
      entityType: "ticket",
      entityId: String(sourceId),
      actorId: req.user!.id,
      payload: { action: "relationship.created", relationshipId: id, target: targetId, relType: type },
    });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    const e = err as Error;
    res.status(400).json({ error: e.message ?? "Failed to create relationship" });
  }
});

/** DELETE /api/graph/relationships/:id — remove a relationship (agent+). */
router.delete("/relationships/:id", async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireStaff(req)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const ok = await deleteRelationship(Number(req.params.id));
    if (!ok) {
      res.status(404).json({ error: "Relationship not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    const e = err as Error;
    res.status(400).json({ error: e.message ?? "Failed to delete relationship" });
  }
});

/** GET /api/graph/entity/:type/:id?depth=2 — unified intelligence graph (#16). */
const ENTITY_TYPES: EntityType[] = [
  "ticket", "incident", "problem", "change", "ci", "knowledge", "user", "department",
];
router.get("/entity/:type/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const type = req.params.type as EntityType;
    if (!ENTITY_TYPES.includes(type)) {
      res.status(400).json({ error: `Unknown entity type. One of: ${ENTITY_TYPES.join(", ")}` });
      return;
    }
    const id = Number(req.params.id);
    const depth = Math.max(0, Math.min(3, Number(req.query.depth) || 2));
    const graph = await getEntityGraph(type, id, req.user!, depth);
    res.json({ ok: true, ...graph });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 400).json({ error: e.message ?? "Failed to load graph" });
  }
});

/** GET /api/graph/similar/:type/:id — similar entities (recommendations). */
router.get("/similar/:type/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const type = req.params.type as "ticket" | "incident" | "problem";
    if (!["ticket", "incident", "problem"].includes(type)) {
      res.status(400).json({ error: "type must be ticket, incident or problem" });
      return;
    }
    const results = await findSimilar(type, Number(req.params.id), req.user!);
    res.json({ ok: true, results });
  } catch (err) {
    const e = err as Error;
    res.status(400).json({ error: e.message ?? "Failed to find similar entities" });
  }
});

/** GET /api/graph/relationship-types — valid relationship types for the UI. */
router.get("/relationship-types", (_req, res) => {
  res.json({ ok: true, types: TICKET_REL_TYPES });
});

export default router;
