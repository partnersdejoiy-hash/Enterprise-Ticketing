import {
  createHash,
  timingSafeEqual,
  randomBytes,
  scrypt as derive,
} from "node:crypto";
import { promisify } from "node:util";
import { pool } from "@workspace/db";
const scrypt = promisify(derive);
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function constantEqual(a: string, b: string) {
  return timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  // Passwords previously published in repository setup examples must be reset.
  if (
    [
      "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      "c37d1f6202341d3a030b1b9e5fa53eed8484f6e6ecc871ca780c03af49eb50e4",
    ].includes(digest(password))
  )
    return false;
  if (stored.startsWith("scrypt$")) {
    const [, salt, expected] = stored.split("$");
    if (
      !/^[a-f0-9]{32}$/.test(salt ?? "") ||
      !/^[a-f0-9]{128}$/.test(expected ?? "")
    )
      return false;
    return constantEqual(
      ((await scrypt(password, salt, 64)) as Buffer).toString("hex"),
      expected,
    );
  }
  // Existing accounts migrate on a successful login; new accounts never use SHA-256.
  return (
    /^[a-f0-9]{64}$/.test(stored) &&
    constantEqual(digest(password + "orbitdesk_salt"), stored)
  );
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const result = await pool.query(
    `INSERT INTO orbit_rate_limits (key, bucket, attempts, expires_at)
    VALUES ($1,$2,1,now() + ($3 * interval '1 second'))
    ON CONFLICT (key,bucket) DO UPDATE SET attempts=orbit_rate_limits.attempts+1 RETURNING attempts`,
    [digest(key), bucket, seconds * 2],
  );
  return result.rows[0].attempts <= limit;
}
export const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
