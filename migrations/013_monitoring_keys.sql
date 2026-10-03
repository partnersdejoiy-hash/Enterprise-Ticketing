-- 010_monitoring_keys.sql
-- API keys for the monitoring event ingest endpoint (Event Intelligence #9).
--
-- Numbered 010 because 009_credential_encryption.sql already exists in this
-- repo. The migrations runner sorts .sql files alphabetically and tracks
-- them by filename in schema_migrations.
--
-- Convention matches monitoring_events / event_correlations in
-- 008_itsm_and_superpowers.sql: tenant_id REFERENCES tenants(id)
-- ON DELETE CASCADE (tenants was created in 007_intelligence_foundation.sql).
-- created_by_id is nullable via ON DELETE SET NULL (matches monitoring
-- source style; keys stay usable if the creator leaves).

BEGIN;

CREATE TABLE IF NOT EXISTS monitoring_api_keys (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,          -- first 8 chars for identification
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_by_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS monitoring_api_keys_active
  ON monitoring_api_keys (is_active, tenant_id);

COMMIT;
