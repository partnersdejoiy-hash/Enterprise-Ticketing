/**
 * Orbit Intelligence API (Superpowers #18, #19, #20).
 *
 * Mounted at /api/intelligence via routes/index.ts.
 *
 * - POST   /intelligence/tickets/:id/triage        run autonomous triage (staff)
 * - GET    /intelligence/tickets/:id/triage        latest triage result
 * - POST   /intelligence/triage/:triageId/override human override (staff)
 * - GET    /intelligence/tickets/:id/next-action  next best action
 * - GET    /intelligence/tickets/:id/duplicates   duplicate candidates
 * - POST   /intelligence/duplicates/:id/merge     merge (staff, explicit)
 * - POST   /intelligence/duplicates/:id/link      link as related (staff)
 * - POST   /intelligence/duplicates/:id/dismiss   dismiss suggestion (staff)
 *
 * Triage NEVER auto-applies changes. Merge is NEVER silent — it requires an
 * explicit staff action with a full audit trail on both tickets.
 */

import { Router } from "express";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import {
  ticketAccess,
  canAccessTicket,
  handlesTicket,
} from "../lib/ticket-access.js";
import {
  triageTicket,
  overrideTriage,
  getLatestTriage,
  getTriageById,
  getDuplicateRelationships,
  ensureProposedDuplicates,
} from "../lib/triage.js";
import { getNextBestAction } from "../lib/next-action.js";

const router = Router();

router.use("/intelligence", authMiddleware);
// Ticket-scoped routes: viewer must have ticket access; writes need staff
// (ticketAccess enforces the staff check for non-GET automatically).
router.use("/intelligence/tickets/:id", ticketAccess);

const badId = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Staff-only guard for non-ticket-scoped routes (override/merge/link/dismiss). */
async function requireStaffOnTicket(
  req: AuthenticatedRequest,
  ticketId: number,
): Promise<boolean> {
  if (!req.user) return false;
  if (!(await canAccessTicket(req.user, ticketId))) return false;
  return handlesTicket(req.user, ticketId);
}

// --- Triage ---------------------------------------------------------------

router.post(
  "/intelligence/tickets/:id/triage",
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = badId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid ticket id" });
      const triage = await triageTicket(id, req.user!.id);
      res.status(201).json({ triage });
    } catch (err: any) {
      console.error("[intelligence] triage failed:", err);
      const msg = String(err?.message ?? err);
      if (msg.includes("denied")) return res.status(403).json({ error: msg });
      if (msg.includes("quota") || msg.includes("unavailable"))
        return res.status(503).json({ error: "AI temporarily unavailable" });
      res.status(500).json({ error: "Triage failed" });
    }
  },
);

router.get(
  "/intelligence/tickets/:id/triage",
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = badId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid ticket id" });
      const triage = await getLatestTriage(id);
      if (!triage)
        return res.status(404).json({ error: "No triage result yet" });
      res.json({ triage });
    } catch (err) {
      console.error("[intelligence] get triage failed:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.post(
  "/intelligence/triage/:triageId/override",
  async (req: AuthenticatedRequest, res) => {
    try {
      const triageId = badId(req.params.triageId);
      if (!triageId)
        return res.status(400).json({ error: "Invalid triage id" });
      const existing = await getTriageById(triageId);
      if (!existing)
        return res.status(404).json({ error: "Triage result not found" });
      if (!(await requireStaffOnTicket(req, existing.ticketId)))
        return res.status(403).json({ error: "Staff access required" });
      const { corrections, note } = req.body ?? {};
      if (!corrections || typeof corrections !== "object")
        return res.status(400).json({ error: "corrections object required" });
      const triage = await overrideTriage(
        triageId,
        req.user!.id,
        corrections as Record<string, unknown>,
        typeof note === "string" ? note : undefined,
      );
      res.json({ triage });
    } catch (err) {
      console.error("[intelligence] override failed:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

// --- Next best action -------------------------------------------------------

router.get(
  "/intelligence/tickets/:id/next-action",
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = badId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid ticket id" });
      const nextAction = await getNextBestAction(id);
      res.json({ nextAction });
    } catch (err: any) {
      console.error("[intelligence] next-action failed:", err);
      if (String(err?.message).includes("not found"))
        return res.status(404).json({ error: "Ticket not found" });
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

// --- Duplicates -------------------------------------------------------------

router.get(
  "/intelligence/tickets/:id/duplicates",
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = badId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid ticket id" });
      let rels = await getDuplicateRelationships(id);
      if (rels.length === 0) {
        // Lazily propose candidates so actions always have stable ids.
        await ensureProposedDuplicates(id);
        rels = await getDuplicateRelationships(id);
      }
      res.json({ duplicates: rels });
    } catch (err) {
      console.error("[intelligence] duplicates failed:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

interface RelRow {
  id: number;
  source_ticket_id: number;
  target_ticket_id: number;
  relationship_type: string;
  status: string;
  source_number: string;
  target_number: string;
  target_status: string;
}

async function loadRelationship(relId: number): Promise<RelRow | null> {
  const { rows } = await pool.query(
    `SELECT r.id, r.source_ticket_id, r.target_ticket_id,
            r.relationship_type, r.status,
            s.ticket_number AS source_number, t.ticket_number AS target_number,
            t.status AS target_status
     FROM ticket_relationships r
     JOIN tickets s ON s.id = r.source_ticket_id
     JOIN tickets t ON t.id = r.target_ticket_id
     WHERE r.id = $1 LIMIT 1`,
    [relId],
  );
  return (rows[0] as RelRow) ?? null;
}

async function history(
  ticketId: number,
  action: string,
  oldValue: string | null,
  newValue: string,
  changedById: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO ticket_history
       (ticket_id, action, old_value, new_value, changed_by_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [ticketId, action, oldValue, newValue, changedById],
  );
}

/**
 * Merge: the TARGET ticket is the duplicate — it gets closed with a full
 * audit trail, and the relationship becomes active. Explicit staff action only.
 */
router.post(
  "/intelligence/duplicates/:id/merge",
  async (req: AuthenticatedRequest, res) => {
    try {
      const relId = badId(req.params.id);
      if (!relId)
        return res.status(400).json({ error: "Invalid relationship id" });
      const rel = await loadRelationship(relId);
      if (!rel || rel.relationship_type !== "duplicate_of")
        return res.status(404).json({ error: "Duplicate suggestion not found" });
      if (rel.status !== "proposed")
        return res.status(409).json({ error: "Suggestion already handled" });
      if (
        !(await requireStaffOnTicket(req, rel.source_ticket_id)) ||
        !(await canAccessTicket(req.user!, rel.target_ticket_id))
      )
        return res.status(403).json({ error: "Staff access required" });
      if (rel.target_status === "closed" || rel.target_status === "resolved")
        return res.status(409).json({ error: "Target ticket already closed" });

      await pool.query(
        `UPDATE ticket_relationships SET status = 'active' WHERE id = $1`,
        [relId],
      );
      await pool.query(
        `UPDATE tickets SET status = 'closed', updated_at = now() WHERE id = $1`,
        [rel.target_ticket_id],
      );
      await history(
        rel.target_ticket_id,
        "merged",
        rel.target_status,
        "closed",
        req.user!.id,
      );
      await history(
        rel.source_ticket_id,
        "duplicate_merged",
        null,
        rel.target_number,
        req.user!.id,
      );
      res.json({
        merged: true,
        keptTicket: rel.source_number,
        closedTicket: rel.target_number,
      });
    } catch (err) {
      console.error("[intelligence] merge failed:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

/** Link: keep both tickets open, record a related_to relationship. */
router.post(
  "/intelligence/duplicates/:id/link",
  async (req: AuthenticatedRequest, res) => {
    try {
      const relId = badId(req.params.id);
      if (!relId)
        return res.status(400).json({ error: "Invalid relationship id" });
      const rel = await loadRelationship(relId);
      if (!rel || rel.relationship_type !== "duplicate_of")
        return res.status(404).json({ error: "Duplicate suggestion not found" });
      if (rel.status !== "proposed")
        return res.status(409).json({ error: "Suggestion already handled" });
      if (
        !(await requireStaffOnTicket(req, rel.source_ticket_id)) ||
        !(await canAccessTicket(req.user!, rel.target_ticket_id))
      )
        return res.status(403).json({ error: "Staff access required" });

      await pool.query(
        `UPDATE ticket_relationships
         SET relationship_type = 'related_to', status = 'active' WHERE id = $1`,
        [relId],
      );
      await history(
        rel.source_ticket_id,
        "ticket_linked",
        null,
        rel.target_number,
        req.user!.id,
      );
      res.json({ linked: true });
    } catch (err) {
      console.error("[intelligence] link failed:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

/** Dismiss: reject the suggestion. Nothing else changes. */
router.post(
  "/intelligence/duplicates/:id/dismiss",
  async (req: AuthenticatedRequest, res) => {
    try {
      const relId = badId(req.params.id);
      if (!relId)
        return res.status(400).json({ error: "Invalid relationship id" });
      const rel = await loadRelationship(relId);
      if (!rel || rel.relationship_type !== "duplicate_of")
        return res.status(404).json({ error: "Duplicate suggestion not found" });
      if (rel.status !== "proposed")
        return res.status(409).json({ error: "Suggestion already handled" });
      if (
        !(await requireStaffOnTicket(req, rel.source_ticket_id)) ||
        !(await canAccessTicket(req.user!, rel.target_ticket_id))
      )
        return res.status(403).json({ error: "Staff access required" });

      await pool.query(
        `UPDATE ticket_relationships SET status = 'rejected' WHERE id = $1`,
        [relId],
      );
      res.json({ dismissed: true });
    } catch (err) {
      console.error("[intelligence] dismiss failed:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

export default router;
