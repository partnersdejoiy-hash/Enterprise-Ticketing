CREATE TABLE IF NOT EXISTS orbit_ai_workers (
 id serial PRIMARY KEY, department_id integer REFERENCES departments(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('triage','draft','pa')), name text NOT NULL DEFAULT '',
 enabled boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='pa' AND department_id IS NULL) OR (kind<>'pa' AND department_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS orbit_ai_worker_department ON orbit_ai_workers(department_id,kind) WHERE department_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orbit_ai_single_pa ON orbit_ai_workers(kind) WHERE kind='pa';
CREATE TABLE IF NOT EXISTS orbit_ai_jobs (
 id serial PRIMARY KEY, worker_id integer NOT NULL REFERENCES orbit_ai_workers(id) ON DELETE CASCADE,
 ticket_id integer NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, revision text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','working','ready','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0, lease_token text, lease_until timestamptz,
 output text, error text, model text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(worker_id,ticket_id,revision)
);
CREATE TABLE IF NOT EXISTS orbit_ai_calls (
 id serial PRIMARY KEY, actor_id integer, purpose text NOT NULL, model text NOT NULL,
 status text NOT NULL DEFAULT 'working', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orbit_ai_calls_date ON orbit_ai_calls(created_at);
CREATE TABLE IF NOT EXISTS orbit_ai_audit (
 id serial PRIMARY KEY, actor_id integer, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO orbit_ai_workers(department_id,kind)
 SELECT d.id,k.kind FROM departments d CROSS JOIN (VALUES ('triage'),('draft')) k(kind)
 ON CONFLICT DO NOTHING;
INSERT INTO orbit_ai_workers(kind) VALUES ('pa') ON CONFLICT DO NOTHING;
