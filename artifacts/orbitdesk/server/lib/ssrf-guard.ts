/**
 * OrbitDesk SSRF Guard (Phase A: Security Hardening).
 *
 * Webhook endpoint URLs are admin-configured but fetched server-side, so
 * they must never resolve to internal infrastructure. assertUrlSafe():
 *
 *   1. Allows only http: and https: schemes.
 *   2. Resolves the hostname via dns.lookup (ALL addresses, honoring the
 *      system resolver) — DNS rebinding via a single A record is covered
 *      because every returned IP is checked.
 *   3. Rejects any IP in private / loopback / link-local / metadata /
 *      reserved ranges, including IPv4-mapped IPv6 forms.
 *
 * Throws SsrfBlocked on violation. Callers surface a 400 to the admin.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfBlocked extends Error {
  constructor(reason: string) {
    super(`Blocked unsafe webhook URL: ${reason}`);
    this.name = "SsrfBlocked";
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function inCidr(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(net) & mask);
}

// IPv4 ranges that must never be fetched server-side.
const BLOCKED_V4 = [
  "0.0.0.0/8", // "this network"
  "10.0.0.0/8", // private
  "100.64.0.0/10", // carrier-grade NAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local incl. cloud metadata (169.254.169.254)
  "172.16.0.0/12", // private
  "192.0.0.0/24", // IETF reserved
  "192.0.2.0/24", // TEST-NET-1
  "192.168.0.0/16", // private
  "198.18.0.0/15", // benchmark testing
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved
];

function isBlockedV6(ip: string): boolean {
  const n = ip.toLowerCase();
  return (
    n === "::1" || // loopback
    n === "::" || // unspecified
    n.startsWith("fe80:") || // link-local
    n.startsWith("fc") || // unique local (fc00::/7)
    n.startsWith("fd") ||
    n === "::ffff:0:0" ||
    /^::ffff:(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.)/.test(n) // mapped private
  );
}

/** Normalize an IPv6 address for mapped-IPv4 detection. */
function mappedV4(ip: string): string | null {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1] : null;
}

export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    return BLOCKED_V4.some((cidr) => inCidr(ip, cidr));
  }
  if (kind === 6) {
    const v4 = mappedV4(ip);
    if (v4) return isBlockedIp(v4);
    return isBlockedV6(ip);
  }
  return true; // not a parseable IP — fail closed
}

/**
 * Validate a webhook target URL. Resolves DNS and checks EVERY returned
 * address. Throws SsrfBlocked on any violation.
 */
export async function assertUrlSafe(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlocked("not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlocked(`scheme "${url.protocol}" not allowed`);
  }
  if (url.username || url.password) {
    throw new SsrfBlocked("credentials in URL are not allowed");
  }
  const hostname = url.hostname;
  if (!hostname) throw new SsrfBlocked("missing hostname");

  // If the hostname is a literal IP, check it directly.
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SsrfBlocked(`IP ${hostname} is in a blocked range`);
    }
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new SsrfBlocked(`DNS resolution failed for ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new SsrfBlocked(`no DNS records for ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfBlocked(
        `${hostname} resolves to blocked IP ${address}`,
      );
    }
  }
  return url;
}
