CREATE TABLE IF NOT EXISTS orbit_ai_chat_threads (
 id serial PRIMARY KEY,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('direct','huddle')),
 worker_id integer REFERENCES orbit_ai_workers(id) ON DELETE CASCADE,
 title text NOT NULL DEFAULT '',
 last_read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='direct' AND worker_id IS NOT NULL) OR (kind='huddle' AND worker_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS orbit_ai_chat_direct_unique
 ON orbit_ai_chat_threads(user_id, worker_id) WHERE kind='direct';
CREATE INDEX IF NOT EXISTS orbit_ai_chat_threads_user
 ON orbit_ai_chat_threads(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS orbit_ai_chat_participants (
 id serial PRIMARY KEY,
 thread_id integer NOT NULL REFERENCES orbit_ai_chat_threads(id) ON DELETE CASCADE,
 worker_id integer NOT NULL REFERENCES orbit_ai_workers(id) ON DELETE CASCADE,
 UNIQUE(thread_id, worker_id)
);
CREATE TABLE IF NOT EXISTS orbit_ai_chat_messages (
 id serial PRIMARY KEY,
 thread_id integer NOT NULL REFERENCES orbit_ai_chat_threads(id) ON DELETE CASCADE,
 sender text NOT NULL CHECK(sender IN ('user','bot')),
 worker_id integer REFERENCES orbit_ai_workers(id) ON DELETE SET NULL,
 user_id integer REFERENCES users(id) ON DELETE SET NULL,
 content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orbit_ai_chat_messages_thread
 ON orbit_ai_chat_messages(thread_id, id);
CREATE INDEX IF NOT EXISTS orbit_ai_chat_messages_unread
 ON orbit_ai_chat_messages(thread_id, created_at) WHERE sender='bot';
