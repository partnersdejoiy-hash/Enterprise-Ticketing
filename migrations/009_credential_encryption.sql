-- 009_credential_encryption.sql
-- Encrypt SMTP/IMAP credentials at rest (Phase A: Security Hardening).
--
-- Strategy: add encrypted columns + a migration flag. Plaintext columns are
-- backfilled lazily by the application on first read (server/lib/email-credentials.ts),
-- because AES-256-GCM can't be done safely inside SQL. The plaintext columns
-- are cleared by the app after successful encryption.
-- New writes ALWAYS go to the encrypted columns.

BEGIN;

ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS smtp_pass_enc TEXT,
  ADD COLUMN IF NOT EXISTS imap_pass_enc TEXT,
  ADD COLUMN IF NOT EXISTS credentials_migrated BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for finding unmigrated rows quickly during the transition window.
CREATE INDEX IF NOT EXISTS idx_email_accounts_unmigrated
  ON email_accounts (id) WHERE credentials_migrated = FALSE;

COMMIT;
