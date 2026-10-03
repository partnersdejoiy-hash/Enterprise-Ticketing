/**
 * Phase A: Security Hardening tests.
 *
 * Covers:
 *  1. Credential vault — AES-256-GCM roundtrip, tamper detection, key handling
 *  2. SSRF guard — private/loopback/metadata IP blocking
 *  3. Rate limiter — sliding window, 429 + Retry-After
 *  4. XSS escaping — escapeHtml used by all email templates
 *
 * Run: pnpm test  (node --import tsx --test tests/*.test.ts)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// A fresh 32-byte key per test process — never a hardcoded secret.
process.env.CREDENTIAL_KEY = randomBytes(32).toString("hex");

const vault = await import(
  "../artifacts/orbitdesk/server/lib/credential-vault.ts"
);
const ssrf = await import("../artifacts/orbitdesk/server/lib/ssrf-guard.ts");
const rl = await import("../artifacts/orbitdesk/server/lib/rate-limit.ts");
const sec = await import("../artifacts/orbitdesk/server/lib/security.ts");

// ─── 1. Credential vault ────────────────────────────────────────────────

test("vault: encrypt/decrypt roundtrip", () => {
  const enc = vault.encryptSecret("s3cr3t-p@ssw0rd!");
  assert.match(enc, /^enc:v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(vault.decryptSecret(enc), "s3cr3t-p@ssw0rd!");
  assert.ok(vault.isEncrypted(enc));
  assert.ok(!vault.isEncrypted("plaintext"));
});

test("vault: unique IV per encryption (no deterministic ciphertext)", () => {
  const a = vault.encryptSecret("same");
  const b = vault.encryptSecret("same");
  assert.notEqual(a, b);
  assert.equal(vault.decryptSecret(a), "same");
  assert.equal(vault.decryptSecret(b), "same");
});

test("vault: tampered ciphertext fails authentication", () => {
  const enc = vault.encryptSecret("secret");
  const parts = enc.split(":");
  // Flip a hex char in the ciphertext segment.
  const ct = parts[3];
  const tamperedCt = (ct[0] === "a" ? "b" : "a") + ct.slice(1);
  assert.throws(
    () => vault.decryptSecret([parts[0], parts[1], parts[2], tamperedCt, parts[4]].join(":")),
    /authentication failed|malformed/,
  );
});

test("vault: wrong key fails authentication", () => {
  const enc = vault.encryptSecret("secret");
  const goodKey = process.env.CREDENTIAL_KEY!;
  process.env.CREDENTIAL_KEY = randomBytes(32).toString("hex");
  try {
    assert.throws(() => vault.decryptSecret(enc), /authentication failed/);
  } finally {
    process.env.CREDENTIAL_KEY = goodKey;
  }
});

test("vault: missing/invalid CREDENTIAL_KEY fails closed", () => {
  const goodKey = process.env.CREDENTIAL_KEY!;
  delete process.env.CREDENTIAL_KEY;
  try {
    assert.throws(() => vault.encryptSecret("x"), /CREDENTIAL_KEY/);
    assert.throws(() => vault.decryptSecret("enc:v1:a:b:c"), /CREDENTIAL_KEY/);
  } finally {
    process.env.CREDENTIAL_KEY = goodKey;
  }
  process.env.CREDENTIAL_KEY = "tooshort";
  try {
    assert.throws(() => vault.encryptSecret("x"), /CREDENTIAL_KEY/);
  } finally {
    process.env.CREDENTIAL_KEY = goodKey;
  }
});

test("vault: decrypt rejects non-encrypted input", () => {
  assert.throws(() => vault.decryptSecret("plaintext"), /not an encrypted/);
  assert.throws(() => vault.decryptSecret("enc:v1:broken"), /malformed/);
});

// ─── 2. SSRF guard ──────────────────────────────────────────────────────

test("ssrf: blocks private IPv4 ranges", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
  ]) {
    assert.ok(ssrf.isBlockedIp(ip), `expected ${ip} to be blocked`);
  }
});

test("ssrf: blocks IPv6 loopback/link-local/mapped", () => {
  assert.ok(ssrf.isBlockedIp("::1"));
  assert.ok(ssrf.isBlockedIp("fe80::1"));
  assert.ok(ssrf.isBlockedIp("::ffff:127.0.0.1"));
  assert.ok(ssrf.isBlockedIp("::ffff:10.0.0.1"));
});

test("ssrf: allows public IPs", () => {
  assert.ok(!ssrf.isBlockedIp("8.8.8.8"));
  assert.ok(!ssrf.isBlockedIp("1.1.1.1"));
});

test("ssrf: assertUrlSafe blocks literal private IPs without DNS", async () => {
  await assert.rejects(
    ssrf.assertUrlSafe("http://127.0.0.1:8080/hook"),
    (e: Error) => e instanceof ssrf.SsrfBlocked,
  );
  await assert.rejects(
    ssrf.assertUrlSafe("https://169.254.169.254/latest/meta-data/"),
    (e: Error) => e instanceof ssrf.SsrfBlocked,
  );
  await assert.rejects(
    ssrf.assertUrlSafe("http://192.168.1.10/hook"),
    (e: Error) => e instanceof ssrf.SsrfBlocked,
  );
});

test("ssrf: assertUrlSafe rejects bad schemes and credentials", async () => {
  await assert.rejects(ssrf.assertUrlSafe("ftp://example.com/x"));
  await assert.rejects(ssrf.assertUrlSafe("file:///etc/passwd"));
  await assert.rejects(ssrf.assertUrlSafe("https://user:pass@example.com/"));
  await assert.rejects(ssrf.assertUrlSafe("not a url"));
});

test("ssrf: assertUrlSafe allows public literal IPs", async () => {
  const url = await ssrf.assertUrlSafe("https://8.8.8.8/hook");
  assert.equal(url.hostname, "8.8.8.8");
});

// ─── 3. Rate limiter ────────────────────────────────────────────────────

function mockReq(ip: string) {
  return { ip, headers: {} } as unknown as Parameters<
    ReturnType<typeof rl.rateLimitMiddleware>
  >[0];
}

function mockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown = null;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: (code: number) => {
      statusCode = code;
      return { json: (b: unknown) => (body = b) };
    },
    _headers: headers,
    _status: () => statusCode,
    _body: () => body,
  };
  return res as unknown as Parameters<
    ReturnType<typeof rl.rateLimitMiddleware>
  >[1] & {
    _headers: Record<string, string>;
    _status: () => number;
    _body: () => unknown;
  };
}

test("rate-limit: allows under the cap, 429s over with Retry-After", () => {
  const mw = rl.rateLimitMiddleware({ windowMs: 60_000, max: 2, name: "T" });
  let nextCalls = 0;
  const next = () => nextCalls++;

  const r1 = mockRes();
  mw(mockReq("9.9.9.9"), r1, next);
  const r2 = mockRes();
  mw(mockReq("9.9.9.9"), r2, next);
  assert.equal(nextCalls, 2);
  assert.equal(r1._headers["X-RateLimit-Remaining"], "1");
  assert.equal(r2._headers["X-RateLimit-Remaining"], "0");

  const r3 = mockRes();
  mw(mockReq("9.9.9.9"), r3, next);
  assert.equal(nextCalls, 2, "third request must not pass");
  assert.equal(r3._status(), 429);
  assert.ok(r3._headers["Retry-After"], "Retry-After header required");
  assert.match(
    String((r3._body() as { error: string }).error),
    /Too many requests/,
  );
});

test("rate-limit: separate buckets per IP", () => {
  const mw = rl.rateLimitMiddleware({ windowMs: 60_000, max: 1, name: "T2" });
  let nextCalls = 0;
  const next = () => nextCalls++;
  mw(mockReq("10.1.1.1"), mockRes(), next);
  mw(mockReq("10.1.1.2"), mockRes(), next);
  assert.equal(nextCalls, 2, "different IPs get independent buckets");
});

// ─── 4. XSS escaping ────────────────────────────────────────────────────

test("xss: escapeHtml neutralizes HTML metacharacters", () => {
  assert.equal(
    sec.escapeHtml(`<script>alert("xss")</script>`),
    `&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;`,
  );
  assert.equal(
    sec.escapeHtml(`O'Brien & Sons <b>bold</b>`),
    `O&#39;Brien &amp; Sons &lt;b&gt;bold&lt;/b&gt;`,
  );
  assert.equal(sec.escapeHtml(`"><img src=x onerror=alert(1)>`), `&quot;&gt;&lt;img src=x onerror=alert(1)&gt;`);
});

test("xss: escapeHtml handles non-string input safely", () => {
  assert.equal(sec.escapeHtml(123), "123");
  assert.equal(sec.escapeHtml(null), "null");
  assert.equal(sec.escapeHtml(undefined), "undefined");
});
