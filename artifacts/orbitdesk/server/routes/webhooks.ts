import { Router } from "express";
import crypto from "crypto";
import { db, webhookEndpointsTable, systemSettingsTable, eq } from "@workspace/db";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";

const router = Router();

// ─── helpers ───────────────────────────────────────────────────────────────

async function getInboundSecret(): Promise<string> {
  const [row] = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, "webhook_inbound_secret"))
    .limit(1);
  if (row) return row.value;
  const newSecret = crypto.randomBytes(24).toString("hex");
  await db.insert(systemSettingsTable).values({ key: "webhook_inbound_secret", value: newSecret });
  return newSecret;
}

export async function dispatchOutgoingWebhooks(event: string, payload: Record<string, unknown>) {
  try {
    const endpoints = await db
      .select()
      .from(webhookEndpointsTable)
      .where(eq(webhookEndpointsTable.enabled, true));

    const matching = endpoints.filter((ep) => {
      const events = ep.events as string[];
      return events.length === 0 || events.includes(event) || events.includes("*");
    });

    for (const ep of matching) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (ep.secretHeader) headers["X-OrbitDesk-Secret"] = ep.secretHeader;
        const res = await fetch(ep.url, {
          method: "POST",
          headers,
          body: JSON.stringify({ event, payload, timestamp: new Date().toISOString() }),
          signal: AbortSignal.timeout(8000),
        });
        console.log("[webhook] dispatched", event, ep.url, "status:", res.status);
      } catch (err) {
        console.warn("[webhook] outgoing failed", event, ep.url, err);
      }
    }
  } catch (err) {
    console.error("[webhook] dispatch error", err);
  }
}

// ─── Inbound webhook (secret-path) ─────────────────────────────────────────

router.post("/inbound/:secret", async (req, res) => {
  const expectedSecret = await getInboundSecret();
  if (req.params.secret !== expectedSecret) {
    res.status(403).json({ error: "Invalid webhook secret" });
    return;
  }
  res.status(200).json({ received: true });
});

// ─── Admin: get inbound secret & outgoing endpoints ─────────────────────────

router.get("/config", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const secret = await getInboundSecret();
  const endpoints = await db.select().from(webhookEndpointsTable).orderBy(webhookEndpointsTable.createdAt);
  res.json({ inboundSecret: secret, endpoints });
});

// ─── Admin: regenerate inbound secret ───────────────────────────────────────

router.post("/config/regenerate-secret", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const newSecret = crypto.randomBytes(24).toString("hex");
  const [existing] = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, "webhook_inbound_secret"))
    .limit(1);

  if (existing) {
    await db
      .update(systemSettingsTable)
      .set({ value: newSecret })
      .where(eq(systemSettingsTable.key, "webhook_inbound_secret"));
  } else {
    await db.insert(systemSettingsTable).values({ key: "webhook_inbound_secret", value: newSecret });
  }
  console.log("[webhook] inbound secret regenerated");
  res.json({ inboundSecret: newSecret });
});

// ─── Outgoing endpoints CRUD ────────────────────────────────────────────────

router.post("/endpoints", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const { name, url, events, secretHeader, enabled } = req.body as {
    name: string; url: string; events: string[]; secretHeader?: string; enabled?: boolean;
  };
  if (!name || !url) { res.status(400).json({ error: "name and url are required" }); return; }
  try { new URL(url); } catch { res.status(400).json({ error: "url must be a valid URL" }); return; }

  const [ep] = await db.insert(webhookEndpointsTable).values({
    name,
    url,
    events: events ?? [],
    secretHeader: secretHeader ?? "",
    enabled: enabled ?? true,
  }).returning();
  res.status(201).json(ep);
});

router.put("/endpoints/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = Number(req.params.id);
  const { name, url, events, secretHeader, enabled } = req.body;
  if (url) { try { new URL(url); } catch { res.status(400).json({ error: "Invalid URL" }); return; } }

  const [ep] = await db
    .update(webhookEndpointsTable)
    .set({ name, url, events, secretHeader, enabled, updatedAt: new Date() })
    .where(eq(webhookEndpointsTable.id, id))
    .returning();
  if (!ep) { res.status(404).json({ error: "Not found" }); return; }
  res.json(ep);
});

router.delete("/endpoints/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = Number(req.params.id);
  const [ep] = await db.delete(webhookEndpointsTable).where(eq(webhookEndpointsTable.id, id)).returning();
  if (!ep) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ deleted: true });
});

router.post("/endpoints/:id/test", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = Number(req.params.id);
  const [ep] = await db.select().from(webhookEndpointsTable).where(eq(webhookEndpointsTable.id, id)).limit(1);
  if (!ep) { res.status(404).json({ error: "Not found" }); return; }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ep.secretHeader) headers["X-OrbitDesk-Secret"] = ep.secretHeader;
    const fetchRes = await fetch(ep.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        event: "test",
        payload: { message: "OrbitDesk webhook test", endpoint: ep.name },
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    res.json({ success: true, status: fetchRes.status, statusText: fetchRes.statusText });
  } catch (err: any) {
    res.json({ success: false, error: err.message ?? "Request failed" });
  }
});

export default router;
