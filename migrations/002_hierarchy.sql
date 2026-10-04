BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id integer REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS raised_for_user_id integer REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tagged_user_ids integer[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS users_manager_idx ON users(manager_id);
CREATE INDEX IF NOT EXISTS tickets_requester_idx ON tickets(created_by_id);
CREATE INDEX IF NOT EXISTS tickets_raised_for_idx ON tickets(raised_for_user_id);
CREATE INDEX IF NOT EXISTS tickets_tagged_users_idx ON tickets USING gin(tagged_user_ids);
CREATE TABLE IF NOT EXISTS user_access_history (
 id bigserial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id),
 changed_by_id integer NOT NULL REFERENCES users(id), changes jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
