/**
 * Email credential resolution with lazy encryption migration.
 *
 * Before migration 009, SMTP/IMAP passwords were stored in plaintext
 * columns (smtp_pass / imap_pass). This module:
 *
 *  1. Reads the encrypted columns (smtp_pass_enc / imap_pass_enc) when
 *     credentials_migrated = true, decrypting via the credential vault.
 *  2. On first read of an unmigrated row, encrypts the plaintext values
 *     into the encrypted columns, clears the plaintext, and sets the flag.
 *  3. Exposes encryptForWrite() so routes always store encrypted values.
 *
 * Raw secrets never leave this module except to the actual SMTP/IMAP
 * connection code. Nothing is logged.
 */

import { db, emailAccountsTable, eq } from "@workspace/db";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
} from "./credential-vault.js";

export interface DecryptedCredentials {
  smtpPass: string;
  imapPass: string;
}

/**
 * Resolve (and decrypt) an account's passwords. Migrates plaintext rows
 * to encrypted storage on first read. Returns empty strings when no
 * password is configured.
 */
export async function getDecryptedCredentials(
  accountId: number,
): Promise<DecryptedCredentials> {
  const [acc] = await db
    .select()
    .from(emailAccountsTable)
    .where(eq(emailAccountsTable.id, accountId))
    .limit(1);
  if (!acc) return { smtpPass: "", imapPass: "" };

  if (acc.credentialsMigrated) {
    return {
      smtpPass: acc.smtpPassEnc ? decryptSecret(acc.smtpPassEnc) : "",
      imapPass: acc.imapPassEnc ? decryptSecret(acc.imapPassEnc) : "",
    };
  }

  // Lazy migration: encrypt existing plaintext in a single UPDATE.
  const smtpPlain = acc.smtpPass ?? "";
  const imapPlain = acc.imapPass ?? "";
  const updates: Partial<typeof emailAccountsTable.$inferInsert> = {
    credentialsMigrated: true,
    smtpPassEnc: smtpPlain ? encryptSecret(smtpPlain) : null,
    imapPassEnc: imapPlain ? encryptSecret(imapPlain) : null,
    // Clear plaintext so it never lingers at rest.
    smtpPass: "",
    imapPass: "",
  };
  await db
    .update(emailAccountsTable)
    .set(updates)
    .where(eq(emailAccountsTable.id, accountId));

  return { smtpPass: smtpPlain, imapPass: imapPlain };
}

/**
 * Prepare password fields for a write (insert/update). Always returns
 * encrypted-column values and marks the row migrated.
 *
 * Usage:
 *   const fields = encryptForWrite(req.body.smtpPass, req.body.imapPass);
 *   await db.update(emailAccountsTable).set({ ...other, ...fields });
 */
export function encryptForWrite(
  smtpPass?: string,
  imapPass?: string,
): Partial<typeof emailAccountsTable.$inferInsert> {
  const out: Partial<typeof emailAccountsTable.$inferInsert> = {
    credentialsMigrated: true,
  };
  if (smtpPass !== undefined) {
    out.smtpPass = "";
    out.smtpPassEnc = smtpPass ? encryptSecret(smtpPass) : null;
  }
  if (imapPass !== undefined) {
    out.imapPass = "";
    out.imapPassEnc = imapPass ? encryptSecret(imapPass) : null;
  }
  return out;
}

/**
 * Convenience for the IMAP poller / SMTP sender when they already hold a
 * full account row (e.g. from a list query). Avoids a second DB round-trip.
 */
export function decryptRowCredentials(acc: {
  id: number;
  smtpPass?: string | null;
  smtpPassEnc?: string | null;
  imapPass?: string | null;
  imapPassEnc?: string | null;
  credentialsMigrated?: boolean | null;
}): DecryptedCredentials {
  if (acc.credentialsMigrated) {
    return {
      smtpPass:
        acc.smtpPassEnc && isEncrypted(acc.smtpPassEnc)
          ? decryptSecret(acc.smtpPassEnc)
          : "",
      imapPass:
        acc.imapPassEnc && isEncrypted(acc.imapPassEnc)
          ? decryptSecret(acc.imapPassEnc)
          : "",
    };
  }
  // Unmigrated row in a bulk list: return plaintext (caller should trigger
  // getDecryptedCredentials to complete the migration). This path is only
  // used for the enabled-check filter, never for actual authentication.
  return {
    smtpPass: acc.smtpPass ?? "",
    imapPass: acc.imapPass ?? "",
  };
}
