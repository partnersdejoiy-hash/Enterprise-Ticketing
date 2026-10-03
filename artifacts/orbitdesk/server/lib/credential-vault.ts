/**
 * OrbitDesk Credential Vault — AES-256-GCM encryption for secrets at rest.
 *
 * Used for SMTP/IMAP passwords in the email_accounts table. The master key
 * comes from the CREDENTIAL_KEY environment variable (64 hex chars = 32 bytes).
 *
 * Format: enc:v1:<iv_hex>:<ciphertext_hex>:<auth_tag_hex>
 *
 * Rules:
 *  - encryptSecret throws if CREDENTIAL_KEY is missing/invalid (fail-closed).
 *  - decryptSecret throws on tampered/malformed input (fail-closed).
 *  - Raw secrets are never logged.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const PREFIX = "enc:v1:";

function masterKey(): Buffer {
  const hex = process.env.CREDENTIAL_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "CREDENTIAL_KEY must be set to 64 hex characters (32 bytes) for credential encryption.",
    );
  }
  return Buffer.from(hex, "hex");
}

/** Encrypt a plaintext secret. Returns "enc:v1:<iv>:<ct>:<tag>". */
export function encryptSecret(plain: string): string {
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    iv.toString("hex") +
    ":" +
    ciphertext.toString("hex") +
    ":" +
    tag.toString("hex")
  );
}

/** Decrypt a value produced by encryptSecret. Throws on any tampering. */
export function decryptSecret(enc: string): string {
  const key = masterKey();
  if (typeof enc !== "string" || !enc.startsWith(PREFIX)) {
    throw new Error("decryptSecret: value is not an encrypted credential");
  }
  const parts = enc.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("decryptSecret: malformed encrypted credential");
  }
  const [ivHex, ctHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ctHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("decryptSecret: malformed encrypted credential");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "decryptSecret: authentication failed (wrong key or tampered data)",
    );
  }
}

/** True if the value looks like a vault-encrypted credential. */
export function isEncrypted(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Constant-time check that two hex strings are equal (for key comparison). */
export function safeKeyEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
