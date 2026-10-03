-- 006_agent_assignment.sql: AI-worker ticket assignment.
-- Adds an optional link from a ticket to the AI worker it was auto-assigned
-- to. AI workers are not rows in the users table, so they cannot use
-- tickets.assignee_id; this column references orbit_ai_workers instead.
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assigned_ai_worker_id integer
  REFERENCES orbit_ai_workers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tickets_assigned_ai_worker
  ON tickets(assigned_ai_worker_id)
  WHERE assigned_ai_worker_id IS NOT NULL;
