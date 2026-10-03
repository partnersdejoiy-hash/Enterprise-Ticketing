BEGIN;
CREATE TABLE IF NOT EXISTS orbit_sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_fingerprint text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orbit_sessions_expiry ON orbit_sessions(expires_at);
CREATE TABLE IF NOT EXISTS orbit_rate_limits (
  key text NOT NULL, bucket bigint NOT NULL, attempts integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL, PRIMARY KEY(key,bucket)
);
CREATE TABLE IF NOT EXISTS orbit_intake_receipts (
  request_id uuid PRIMARY KEY,
  payload_hash text NOT NULL,
  ticket_id integer NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  ticket_number text NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('employment-verification','background-verification')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_tags_gin ON tickets USING gin(tags);
CREATE INDEX IF NOT EXISTS tickets_department_status ON tickets(department_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_attachments_ticket ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS ticket_comments_ticket ON ticket_comments(ticket_id,created_at);
COMMIT;
