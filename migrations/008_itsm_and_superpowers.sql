-- 008_itsm_and_superpowers.sql: ITSM core + superpower entity tables.
--
-- Part 1: ITSM (incidents, problems, changes)
-- Part 2: CMDB / assets
-- Part 3: Ticket relationship graph (#2)
-- Part 4: Monitoring / event intelligence (#9)
-- Part 5: Swarm rooms (#5)
-- Part 6: Service catalog (#10)
-- Part 7: Knowledge + organizational memory (#14, #25)
-- Part 8: Runbooks / self-healing (#13)
-- Part 9: Triage, queue, workload, briefs, notifications

BEGIN;

-- ============================================================
-- PART 1: ITSM CORE
-- ============================================================
CREATE TABLE IF NOT EXISTS incidents (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  incident_number text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'medium', -- critical|high|medium|low
  status text NOT NULL DEFAULT 'open',     -- open|investigating|mitigated|resolved|closed
  is_major boolean NOT NULL DEFAULT false,
  commander_id integer REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  mitigated_at timestamptz,
  resolved_at timestamptz,
  postmortem_status text NOT NULL DEFAULT 'not_started',
  deleted_at timestamptz,
  created_by_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_status_sev ON incidents(status, severity);
CREATE INDEX IF NOT EXISTS incidents_major ON incidents(is_major, status)
  WHERE is_major AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS incident_tickets (
  incident_id integer NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  ticket_id integer NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (incident_id, ticket_id)
);

CREATE TABLE IF NOT EXISTS problems (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  problem_number text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open', -- open|investigating|known_error|resolved|closed
  root_cause text,                     -- human-authored/confirmed only
  root_cause_confirmed_by_id integer,
  root_cause_confirmed_at timestamptz,
  workaround text,
  deleted_at timestamptz,
  created_by_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Root-cause hypotheses are probabilistic until a human confirms (#6).
CREATE TABLE IF NOT EXISTS root_cause_hypotheses (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,           -- incident|problem
  entity_id integer NOT NULL,
  hypothesis text NOT NULL,
  confidence numeric(5,2),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'proposed', -- proposed|confirmed|rejected
  decided_by_id integer,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rca_hypotheses_entity
  ON root_cause_hypotheses(entity_type, entity_id, status);

CREATE TABLE IF NOT EXISTS changes (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  change_number text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  change_type text NOT NULL DEFAULT 'standard', -- standard|normal|emergency
  risk text NOT NULL DEFAULT 'medium',          -- low|medium|high
  status text NOT NULL DEFAULT 'draft', -- draft|pending_approval|approved|scheduled|implementing|completed|failed|rolled_back|cancelled
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  rollback_plan text,
  impact_analysis jsonb DEFAULT '{}'::jsonb,    -- #17 output
  deleted_at timestamptz,
  created_by_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS changes_status ON changes(status);

-- Generic approval workflow (changes, catalog requests, AI actions).
CREATE TABLE IF NOT EXISTS approvals (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,           -- change|catalog_request|ai_action
  entity_id text NOT NULL,
  step_order integer NOT NULL DEFAULT 1,
  approver_id integer REFERENCES users(id) ON DELETE SET NULL,
  approver_role text,
  status text NOT NULL DEFAULT 'pending', -- pending|approved|rejected|skipped
  decided_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approvals_entity
  ON approvals(entity_type, entity_id, step_order);
-- Backfill FK from ai_actions.approval_id (created in 007).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_actions_approval') THEN
    ALTER TABLE ai_actions ADD CONSTRAINT fk_ai_actions_approval
      FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- ============================================================
-- PART 2: CMDB / ASSETS
-- ============================================================
CREATE TABLE IF NOT EXISTS configuration_items (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  ci_type text NOT NULL,               -- server|service|application|network|database|...
  status text NOT NULL DEFAULT 'active',
  owner_id integer REFERENCES users(id) ON DELETE SET NULL,
  department_id integer REFERENCES departments(id) ON DELETE SET NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  health text NOT NULL DEFAULT 'healthy', -- healthy|watch|at_risk|critical (#26)
  health_score numeric(5,2),
  health_computed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ci_type_status ON configuration_items(ci_type, status);
CREATE TABLE IF NOT EXISTS ci_relationships (
  id serial PRIMARY KEY,
  source_ci_id integer NOT NULL REFERENCES configuration_items(id) ON DELETE CASCADE,
  target_ci_id integer NOT NULL REFERENCES configuration_items(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,     -- depends_on|hosts|runs_on|connects_to|...
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_ci_id, target_ci_id, relationship_type)
);

-- ============================================================
-- PART 3: TICKET RELATIONSHIP GRAPH (#2)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticket_relationships (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  source_ticket_id integer NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  target_ticket_id integer NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  relationship_type text NOT NULL, -- related_to|duplicate_of|parent_of|child_of|caused_by|resolved_by
  created_by_id integer,           -- null = AI-suggested
  ai_confidence numeric(5,2),
  status text NOT NULL DEFAULT 'active', -- active|proposed|rejected
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_ticket_id, target_ticket_id, relationship_type),
  CHECK (source_ticket_id <> target_ticket_id)
);
CREATE INDEX IF NOT EXISTS ticket_rel_source ON ticket_relationships(source_ticket_id);
CREATE INDEX IF NOT EXISTS ticket_rel_target ON ticket_relationships(target_ticket_id);

-- ============================================================
-- PART 4: MONITORING / EVENT INTELLIGENCE (#9)
-- ============================================================
CREATE TABLE IF NOT EXISTS monitoring_events (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  source text NOT NULL,                -- zabbix|datadog|prometheus|custom
  fingerprint text NOT NULL,           -- dedup/correlation key
  severity text NOT NULL,              -- critical|high|warning|info
  title text NOT NULL,
  message text,
  service_name text,
  host text,
  ci_id integer REFERENCES configuration_items(id) ON DELETE SET NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new',  -- new|correlated|incident_created|suppressed|resolved
  incident_id integer REFERENCES incidents(id) ON DELETE SET NULL,
  ticket_id integer REFERENCES tickets(id) ON DELETE SET NULL,
  dedup_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mon_events_fingerprint
  ON monitoring_events(tenant_id, fingerprint, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS mon_events_status ON monitoring_events(status, severity);

CREATE TABLE IF NOT EXISTS event_correlations (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id integer NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES monitoring_events(id) ON DELETE CASCADE,
  correlation_type text NOT NULL,       -- fingerprint|service|host|time_window
  confidence numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_id, event_id)
);

-- ============================================================
-- PART 5: SWARM ROOMS (#5, #22)
-- ============================================================
CREATE TABLE IF NOT EXISTS swarm_rooms (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id integer NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active', -- active|resolved|archived
  commander_id integer REFERENCES users(id) ON DELETE SET NULL,
  ai_summary text,
  ai_summary_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS swarm_members (
  room_id integer NOT NULL REFERENCES swarm_rooms(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'participant', -- commander|tech_lead|support_lead|...
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS swarm_messages (
  id bigserial PRIMARY KEY,
  room_id integer NOT NULL REFERENCES swarm_rooms(id) ON DELETE CASCADE,
  sender_id integer REFERENCES users(id) ON DELETE SET NULL,
  sender_type text NOT NULL DEFAULT 'user', -- user|ai
  message_type text NOT NULL DEFAULT 'chat', -- chat|note|decision|status_update
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS swarm_messages_room ON swarm_messages(room_id, created_at);
CREATE TABLE IF NOT EXISTS swarm_tasks (
  id serial PRIMARY KEY,
  room_id integer NOT NULL REFERENCES swarm_rooms(id) ON DELETE CASCADE,
  title text NOT NULL,
  assignee_id integer REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open', -- open|in_progress|done
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- ============================================================
-- PART 6: SERVICE CATALOG (#10)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_catalog_items (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL,               -- IT|HR|Finance|Facilities|Security|Legal|Procurement|Admin
  description text,
  form_schema jsonb NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  approval_chain jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{role, order}]
  sla_policy_id integer REFERENCES sla_policies(id) ON DELETE SET NULL,
  department_id integer REFERENCES departments(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS service_catalog_requests (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES service_catalog_items(id) ON DELETE RESTRICT,
  request_number text NOT NULL UNIQUE,
  requester_id integer REFERENCES users(id) ON DELETE SET NULL,
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'submitted', -- submitted|in_approval|approved|rejected|fulfilling|completed|cancelled
  ticket_id integer REFERENCES tickets(id) ON DELETE SET NULL,
  current_step integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- PART 7: KNOWLEDGE + ORGANIZATIONAL MEMORY (#14, #25)
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_articles (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  category text,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft', -- draft|in_review|published|archived
  version integer NOT NULL DEFAULT 1,
  view_count integer NOT NULL DEFAULT 0,
  helpful_count integer NOT NULL DEFAULT 0,
  searchable boolean NOT NULL DEFAULT true, -- admin-controlled memory inclusion
  published_at timestamptz,
  deleted_at timestamptz,
  created_by_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_searchable ON knowledge_articles(searchable, status)
  WHERE deleted_at IS NULL;
-- Full-text search over published articles.
CREATE INDEX IF NOT EXISTS kb_fts ON knowledge_articles
  USING gin (to_tsvector('english', title || ' ' || content))
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS organizational_memory (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  source_type text NOT NULL,           -- ticket|incident|problem|change|knowledge|postmortem
  source_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  embedding_ref text,                  -- pointer for future vector store
  searchable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS orgmem_search ON organizational_memory(searchable, source_type);

-- Knowledge gap signals (#25).
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  suggested_title text NOT NULL,
  draft_content text,
  ticket_ids integer[] NOT NULL DEFAULT '{}',
  occurrence_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'proposed', -- proposed|approved|rejected|published
  article_id integer REFERENCES knowledge_articles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- PART 8: RUNBOOKS / SELF-HEALING (#13)
-- ============================================================
CREATE TABLE IF NOT EXISTS runbooks (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_condition jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. {metric: disk_usage, gt: 90}
  steps jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{action, params, risk}]
  max_risk text NOT NULL DEFAULT 'low',     -- low|medium|high (never critical auto)
  requires_approval boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT false, -- explicit opt-in only
  created_by_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS runbook_executions (
  id bigserial PRIMARY KEY,
  runbook_id integer NOT NULL REFERENCES runbooks(id) ON DELETE RESTRICT,
  incident_id integer REFERENCES incidents(id) ON DELETE SET NULL,
  event_id bigint REFERENCES monitoring_events(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_approval', -- pending_approval|approved|rejected|running|completed|failed
  approval_id bigint REFERENCES approvals(id) ON DELETE SET NULL,
  steps_log jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{step, result, at}]
  verification jsonb,
  executed_by text NOT NULL DEFAULT 'automation',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- ============================================================
-- PART 9: TRIAGE, QUEUE, WORKLOAD, BRIEFS, NOTIFICATIONS
-- ============================================================
-- Autonomous triage results (#20) — original AI call + human override.
CREATE TABLE IF NOT EXISTS ai_triage_results (
  id bigserial PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  intent text,
  category text,
  subcategory text,
  priority_recommendation text,
  urgency text,
  impact text,
  department_id integer REFERENCES departments(id) ON DELETE SET NULL,
  skills_required text[] NOT NULL DEFAULT '{}',
  sentiment text,
  language text,
  duplicate_of_ticket_id integer REFERENCES tickets(id) ON DELETE SET NULL,
  security_risk text,                  -- none|low|medium|high
  sla_policy_id integer REFERENCES sla_policies(id) ON DELETE SET NULL,
  confidence numeric(5,2),
  overridden boolean NOT NULL DEFAULT false,
  override_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS triage_ticket ON ai_triage_results(ticket_id, created_at DESC);

-- Queue optimizer recommendations (#7).
CREATE TABLE IF NOT EXISTS queue_recommendations (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id integer NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  recommended_agent_id integer REFERENCES users(id) ON DELETE SET NULL,
  policy text NOT NULL,                -- round_robin|least_loaded|skill_based|ai_recommended
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric(5,2),
  applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Workload forecasts (#27).
CREATE TABLE IF NOT EXISTS workload_predictions (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  department_id integer REFERENCES departments(id) ON DELETE CASCADE,
  forecast_date date NOT NULL,
  predicted_volume integer NOT NULL,
  confidence text NOT NULL,            -- low|medium|high (never certainty)
  basis jsonb NOT NULL DEFAULT '{}'::jsonb, -- historical evidence
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, department_id, forecast_date)
);

-- Executive briefs (#12) — every number traceable to a query.
CREATE TABLE IF NOT EXISTS executive_briefs (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  period text NOT NULL,                -- daily|weekly
  brief_date date NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period, brief_date)
);

-- Automation execution log (Phase C).
CREATE TABLE IF NOT EXISTS automation_executions (
  id bigserial PRIMARY KEY,
  rule_id integer REFERENCES automation_rules(id) ON DELETE SET NULL,
  trigger_type text NOT NULL,
  entity_type text,
  entity_id text,
  status text NOT NULL DEFAULT 'success', -- success|failed|skipped
  actions_taken jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS autoexec_rule_time
  ON automation_executions(rule_id, created_at DESC);

-- Notification center.
CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,                  -- sla_warning, assignment, mention, approval, ...
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user
  ON notifications(user_id, is_read, created_at DESC);

-- Risk predictions (#4).
CREATE TABLE IF NOT EXISTS risk_predictions (
  id bigserial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  risk_type text NOT NULL,             -- service|asset|department
  ref_type text NOT NULL,
  ref_id text NOT NULL,
  risk_level text NOT NULL,            -- low|medium|high|critical
  title text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open', -- open|acknowledged|resolved|dismissed
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS risk_pred_status ON risk_predictions(status, risk_level);

COMMIT;
