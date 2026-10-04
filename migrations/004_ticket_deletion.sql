-- Keep only a request tombstone so a delivery retry cannot recreate a deleted ticket.
BEGIN;
ALTER TABLE orbit_intake_receipts ALTER COLUMN ticket_id DROP NOT NULL;
ALTER TABLE orbit_intake_receipts DROP CONSTRAINT IF EXISTS orbit_intake_receipts_ticket_id_fkey;
ALTER TABLE orbit_intake_receipts ADD CONSTRAINT orbit_intake_receipts_ticket_id_fkey FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS orbit_ticket_deletions (
 ticket_id integer PRIMARY KEY, ticket_number text NOT NULL,
 deleted_by integer NOT NULL, deleted_at timestamptz NOT NULL DEFAULT now()
);
DO $constraints$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orbit_comments_ticket_fk') THEN
  ALTER TABLE ticket_comments ADD CONSTRAINT orbit_comments_ticket_fk FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orbit_history_ticket_fk') THEN
  ALTER TABLE ticket_history ADD CONSTRAINT orbit_history_ticket_fk FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orbit_attachments_ticket_fk') THEN
  ALTER TABLE ticket_attachments ADD CONSTRAINT orbit_attachments_ticket_fk FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE NOT VALID;
 END IF;
END $constraints$;
COMMIT;
