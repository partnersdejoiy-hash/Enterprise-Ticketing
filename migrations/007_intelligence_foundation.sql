-- 007_intelligence_foundation.sql: OrbitDesk Maha Kaali Superpowers Engine
-- Unified intelligence layer foundation.
--
-- Part 1: Multi-tenancy prep (backward-compatible, nullable)
-- Part 2: Domain event bus tables
-- Part 3: AI pipeline tables (analysis, recommendations, actions, audit)
-- Part 4: SLA engine tables
-- Part 5: Security shield tables
-- Part 6: Critical index + FK fixes from audit
--
-- All new tables use timestamptz, have audit fields, and support soft-delete
-- where appropriate. tenant_id is nullable for backward compatibility;
-- a 'default' tenant row is seeded.

BEGIN;

-- ============================================================
-- PART 1: TENANTS (backward-compatible multi-tenancy prep)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tenants (name, slug) VALUES ('Default Workspace', 'default')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- PART 2: DOMAIN EVENT BUS
-- ============================================================
-- Every significant domain change emits an event here. AI, automation,
-- notifications, SLA evaluation and analytics all consume from this log.
CREATE TABLE IF NOT EXISTS domain_events (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,           -- e.g. ticket.created, sla.breached
  entity_type text NOT NULL,          -- ticket, incident, change, ...
  entity_id text NOT NULL,            -- string to allow uuid/int ids
  actor_id integer,                   -- users.id, null for system
  actor_type text NOT NULL DEFAULT 'user', -- user | ai | automation | system
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS domain_events_type_time
  ON domain_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_events_entity
  ON domain_events(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_events_tenant_time
  ON domain_events(tenant_id, created_at DESC);

-- ============================================================
-- PART 3: AI PIPELINE
-- ============================================================
-- Unified AI analysis results. Every AI feature writes here with
-- confidence, sources and grounding — never bare text.
CREATE TABLE IF NOT EXISTS ai_analyses (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  feature text NOT NULL,              -- triage, sla_prediction, rca, ...
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  status text NOT NULL DEFAULT 'completed', -- pending|completed|failed
  confidence numeric(5,2),            -- 0-100
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{type,id,title,url}]
  model text,
  prompt_version text,
  tokens_used integer,
  duration_ms integer,
  error text,
  created_by_id integer,              -- requesting user, null for system
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_analyses_entity
  ON ai_analyses(feature, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_analyses_tenant
  ON ai_analyses(tenant_id, created_at DESC);

-- AI recommendations awaiting human decision.
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  analysis_id bigint REFERENCES ai_analyses(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  kind text NOT NULL,                 -- reassign, escalate, merge, approve, ...
  title text NOT NULL,
  detail text,
  confidence numeric(5,2),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending', -- pending|approved|rejected|expired|executed
  decided_by_id integer,
  decided_at timestamptz,
  decision_note text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_recommendations_entity_status
  ON ai_recommendations(entity_type, entity_id, status);

-- Every AI-originated action, with full authorization trail.
CREATE TABLE IF NOT EXISTS ai_actions (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  recommendation_id bigint REFERENCES ai_recommendations(id) ON DELETE SET NULL,
  action_type text NOT NULL,          -- assign, escalate, notify, runbook, ...
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_level text NOT NULL DEFAULT 'low', -- low|medium|high|critical
  approval_id bigint,                 -- set below via approvals table
  approved_by_id integer,
  status text NOT NULL DEFAULT 'proposed', -- proposed|approved|rejected|executed|failed
  result jsonb,
  executed_at timestamptz,
  created_by text NOT NULL DEFAULT 'ai', -- ai|automation|user
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_actions_entity
  ON ai_actions(entity_type, entity_id, created_at DESC);

-- Immutable AI audit log: every AI call, decision and data access.
CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id integer,
  actor_type text NOT NULL DEFAULT 'ai',
  action text NOT NULL,               -- analysis.run, data.access, action.propose, ...
  entity_type text,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_audit_logs_actor_time
  ON ai_audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_audit_logs_entity
  ON ai_audit_logs(entity_type, entity_id, created_at DESC);

-- ============================================================
-- PART 4: SLA ENGINE
-- ============================================================
CREATE TABLE IF NOT EXISTS sla_policies (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  department_id integer REFERENCES departments(id) ON DELETE SET NULL,
  priority text,                      -- urgent|high|medium|low, null = any
  first_response_minutes integer NOT NULL,
  resolution_minutes integer NOT NULL,
  business_hours_only boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business_calendars (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  work_days integer[] NOT NULL DEFAULT '{1,2,3,4,5}', -- 0=Sun..6=Sat
  work_start time NOT NULL DEFAULT '09:00',
  work_end time NOT NULL DEFAULT '18:00',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS holidays (
  id serial PRIMARY KEY,
  calendar_id integer REFERENCES business_calendars(id) ON DELETE CASCADE,
  name text NOT NULL,
  holiday_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Per-ticket SLA tracking (one row per ticket).
CREATE TABLE IF NOT EXISTS ticket_sla (
  ticket_id integer PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  policy_id integer REFERENCES sla_policies(id) ON DELETE SET NULL,
  first_response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  paused_seconds integer NOT NULL DEFAULT 0,
  pause_started_at timestamptz,
  breach_notified boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Predictive SLA outputs (#1).
CREATE TABLE IF NOT EXISTS sla_predictions (
  id bigserial PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  breach_probability numeric(5,2) NOT NULL, -- 0-100
  predicted_breach_at timestamptz,
  health text NOT NULL,              -- safe|at_risk|critical|breached
  confidence numeric(5,2),
  factors jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{factor, weight, detail}]
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sla_predictions_ticket_time
  ON sla_predictions(ticket_id, created_at DESC);

-- ============================================================
-- PART 5: SECURITY SHIELD (#8)
-- ============================================================
CREATE TABLE IF NOT EXISTS security_detections (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,          -- ticket, email, attachment, webhook, ...
  entity_id text NOT NULL,
  field_name text,                    -- subject, body, filename, ...
  detection_type text NOT NULL,       -- secret, pii, injection, malicious_url, ...
  risk_level text NOT NULL,           -- low|medium|high|critical
  evidence text,                      -- redacted snippet, never raw secret
  recommendation text,
  status text NOT NULL DEFAULT 'open', -- open|reviewed|dismissed|resolved
  reviewed_by_id integer,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_detections_entity
  ON security_detections(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_detections_status
  ON security_detections(status, risk_level, created_at DESC);

-- ============================================================
-- PART 6: AUDIT FIXES — indexes + FKs (from 2026-10-03 audit)
-- ============================================================
-- High-value missing indexes.
CREATE INDEX IF NOT EXISTS tickets_assignee_id_idx ON tickets(assignee_id);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_priority_idx ON tickets(priority);
CREATE INDEX IF NOT EXISTS tickets_updated_at_idx ON tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS tickets_department_status_idx
  ON tickets(department_id, status);
CREATE INDEX IF NOT EXISTS ticket_history_ticket_id_idx
  ON ticket_history(ticket_id);
CREATE INDEX IF NOT EXISTS users_department_id_idx ON users(department_id);
CREATE INDEX IF NOT EXISTS orbit_ai_jobs_status_idx ON orbit_ai_jobs(status);
CREATE INDEX IF NOT EXISTS automation_rules_active_trigger_idx
  ON automation_rules(is_active, trigger_type);
CREATE INDEX IF NOT EXISTS ticket_comments_ticket_id_idx ON ticket_comments(ticket_id);

-- Enforce key relationships (validated, concurrent-safe).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_department') THEN
    ALTER TABLE tickets ADD CONSTRAINT fk_tickets_department
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_assignee') THEN
    ALTER TABLE tickets ADD CONSTRAINT fk_tickets_assignee
      FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_created_by') THEN
    ALTER TABLE tickets ADD CONSTRAINT fk_tickets_created_by
      FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_department') THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_department
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
-- Validate in a second pass (safe on large tables).
ALTER TABLE tickets VALIDATE CONSTRAINT fk_tickets_department;
ALTER TABLE tickets VALIDATE CONSTRAINT fk_tickets_assignee;
ALTER TABLE tickets VALIDATE CONSTRAINT fk_tickets_created_by;
ALTER TABLE users VALIDATE CONSTRAINT fk_users_department;

COMMIT;
