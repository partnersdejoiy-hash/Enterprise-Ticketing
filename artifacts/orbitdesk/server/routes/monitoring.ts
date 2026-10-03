/**
 * Monitoring Event Intelligence routes (#9).
 *
 * Mounted at /api/monitoring:
 *   POST /events                — ingest (API-key auth: X-API-Key or
 *                                 Authorization: Bearer odm_…)
 *   GET  /events                — list (session auth)
 *   POST /events/:id/suppress   — suppress (session auth, any role)
 *   GET  /keys                  — list keys (session auth, admin only;
 *                                 never exposes key hashes)
 *   POST /keys                  — create key (session auth, admin only;
 *                                 plaintext key returned ONCE)
 *   POST /keys/:id/revoke       — revoke key (session auth, admin only)
 */

import { Router, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  requireAdmin,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import {
  generateApiKey,
  ingestEvent,
  verifyApiKey,
  type ApiKeyInfo,
} from "../lib/event-intelligence.js";

const router = Router();

interface MonitoringRequest extends AuthenticatedRequest {
  apiKey?: ApiKeyInfo;
}

function extractApiKey(req: MonitoringRequest): string | null {
  const header = req.headers["x-api-key"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(odm_\S+)\s*$/i);
    if (m) return m[1];
  }
  return null;
}

/** API-key auth for the ingest endpoint — deliberately NOT session auth. */
async function apiKeyMiddleware(
  req: MonitoringRequest,
  res: Response,
  next: NextFunction,
) {
  const key = extractApiKey(req);
  if (!key) {
    res.status(401).json({
      error: "Missing API key (X-API-Key header or Authorization: Bearer)",
    });
    return;
  }
  const keyInfo = await verifyApiKey(key);
  if (!keyInfo) {
    res.status(401).json({ error: "Invalid or revoked API key" });
    return;
  }
  req.apiKey = keyInfo;
  next();
}

// ---------------------------------------------------------------------------
// Ingest (API-key auth)
// ---------------------------------------------------------------------------

router.post("/events", apiKeyMiddleware, async (req: MonitoringRequest, res) => {
  try {
    const result = await ingestEvent(req.body ?? {}, req.apiKey!);
    res.status(202).json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Validation errors → 400; anything else → 500.
    const status = /^(\w+ (is required|must be)|Request body)/i.test(message)
      ? 400
      : 500;
    res.status(status).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Events list (session auth)
// ---------------------------------------------------------------------------

router.get(
  "/events",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status, severity, limit } = req.query;
      const conditions: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (typeof status === "string" && status.trim()) {
        conditions.push(`me.status = $${i++}`);
        params.push(status.trim());
      }
      if (typeof severity === "string" && severity.trim()) {
        conditions.push(`me.severity = $${i++}`);
        params.push(severity.trim().toLowerCase());
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      let lim = 50;
      if (typeof limit === "string" && /^\d+$/.test(limit)) {
        lim = Math.min(Math.max(Number(limit), 1), 200);
      }
      const { rows } = await pool.query(
        `SELECT me.id, me.source, me.fingerprint, me.severity, me.title,
                me.message, me.service_name AS "serviceName", me.host,
                me.status, me.incident_id AS "incidentId",
                me.ticket_id AS "ticketId", me.dedup_count AS "dedupCount",
                me.first_seen_at AS "firstSeenAt",
                me.last_seen_at AS "lastSeenAt",
                i.incident_number AS "incidentNumber",
                t.ticket_number AS "ticketNumber"
         FROM monitoring_events me
         LEFT JOIN incidents i ON i.id = me.incident_id
         LEFT JOIN tickets t ON t.id = me.ticket_id
         ${where}
         ORDER BY me.last_seen_at DESC
         LIMIT $${i}`,
        [...params, lim],
      );
      res.json({ events: rows });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

// ---------------------------------------------------------------------------
// Suppress (session auth; any authenticated user may suppress — this is a
// triage action, not a destructive one; the event record stays)
// ---------------------------------------------------------------------------

router.post(
  "/events/:id/suppress",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        res.status(400).json({ error: "Invalid event id" });
        return;
      }
      const { rowCount } = await pool.query(
        `UPDATE monitoring_events SET status = 'suppressed' WHERE id = $1`,
        [id],
      );
      if (!rowCount) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      res.json({ ok: true, id, status: "suppressed" });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

// ---------------------------------------------------------------------------
// API key management (session auth, admin only)
// ---------------------------------------------------------------------------

router.get(
  "/keys",
  authMiddleware,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, key_prefix AS "keyPrefix",
                is_active AS "isActive",
                last_used_at AS "lastUsedAt",
                created_at AS "createdAt"
         FROM monitoring_api_keys
         ORDER BY created_at DESC`,
        // NOTE: key_hash is deliberately never exposed here.
      );
      res.json({ keys: rows });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

router.post(
  "/keys",
  authMiddleware,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const name =
        typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      if (name.length > 120) {
        res.status(400).json({ error: "name must be at most 120 characters" });
        return;
      }
      const { key, keyHash, keyPrefix } = generateApiKey();
      // usersTable's drizzle schema carries no tenant field; look it up raw
      // (same approach as server/lib/root-cause.ts).
      let creatorTenantId: number | null = null;
      if (req.user?.id) {
        try {
          const t = await pool.query(
            `SELECT tenant_id FROM users WHERE id = $1 LIMIT 1`,
            [req.user.id],
          );
          creatorTenantId = (t.rows[0]?.tenant_id ?? null) as number | null;
        } catch {
          creatorTenantId = null;
        }
      }
      const { rows } = await pool.query(
        `INSERT INTO monitoring_api_keys
           (tenant_id, name, key_hash, key_prefix, created_by_id)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, name, key_prefix AS "keyPrefix",
                   is_active AS "isActive", created_at AS "createdAt"`,
        [
          creatorTenantId,
          name,
          keyHash,
          keyPrefix,
          req.user?.id ?? null,
        ],
      );
      // The plaintext key is returned exactly ONCE, here. It cannot be
      // retrieved again — only the hash is stored.
      res.status(201).json({ key, ...rows[0] });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

router.post(
  "/keys/:id/revoke",
  authMiddleware,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        res.status(400).json({ error: "Invalid key id" });
        return;
      }
      const { rowCount } = await pool.query(
        `UPDATE monitoring_api_keys SET is_active = false WHERE id = $1`,
        [id],
      );
      if (!rowCount) {
        res.status(404).json({ error: "Key not found" });
        return;
      }
      res.json({ ok: true, id, revoked: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

export default router;
