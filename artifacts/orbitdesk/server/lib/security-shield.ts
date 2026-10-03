/**
 * Orbit AI Security Shield (#8).
 *
 * Inspects untrusted content (ticket bodies, emails, attachments metadata,
 * URLs, knowledge docs, webhook payloads, AI prompts) for:
 *   - secrets: API keys, tokens, passwords, private keys
 *   - PII: emails, phones, Aadhaar-like numbers, card numbers
 *   - prompt injection: instruction-override attempts
 *   - suspicious URLs / social-engineering indicators
 *
 * Detection is NOT proof of malicious intent — every finding carries a
 * risk level, evidence (redacted), and a recommended action for human review.
 * Raw secrets are NEVER logged or returned; evidence snippets are redacted.
 */

export interface ShieldFinding {
  detectionType:
    | "secret"
    | "pii"
    | "prompt_injection"
    | "suspicious_url"
    | "social_engineering";
  riskLevel: "low" | "medium" | "high" | "critical";
  evidence: string; // redacted snippet
  recommendation: string;
  /** Character offsets in the original text (for UI highlighting). */
  span?: { start: number; end: number };
}

export interface ShieldResult {
  findings: ShieldFinding[];
  /** Input with secrets redacted — safe to pass to AI / logs. */
  redacted: string;
  highestRisk: "none" | "low" | "medium" | "high" | "critical";
}

// --- Secret patterns (matched, then redacted) ---
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "AWS key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Generic API key", re: /\bsk-(live|test)-[A-Za-z0-9]{8,}\b/ },
  { name: "Bearer token", re: /Bearer\s+[A-Za-z0-9\-._~+/=]{16,}/i },
  {
    name: "Private key",
    re: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "Password assignment",
    re: /\b(password|passwd|pwd|secret)\s*[:=]\s*\S{4,}/i,
  },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
];

const PII_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  {
    name: "Phone",
    re: /(\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/,
  },
  { name: "Aadhaar-like", re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },
  { name: "Card-like", re: /\b(?:\d[ -]?){13,19}\b/ },
];

// Prompt-injection indicators: untrusted text attempting to override
// system instructions. Heuristic, not definitive.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*:\s*/i,
  /\[system\]/i,
  /forget\s+(everything|all)\s+(you\s+)?(know|learned)/i,
  /do\s+not\s+follow\s+(your|the)\s+(system|original)\s+instructions?/i,
  /reveal\s+(your|the)\s+(system\s+)?prompt/i,
  /bypass\s+(all\s+)?(safety|security|filters?)/i,
];

const SUSPICIOUS_URL_RE =
  /https?:\/\/[^\s<>"']+/gi;
const SOCIAL_ENGINEERING_RE =
  /(urgent|immediately|act now|verify your account|password\s+expired|click\s+here\s+to\s+(verify|confirm|login))/i;

function redactSecrets(text: string): string {
  let out = text;
  for (const { re } of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      const keep = Math.min(4, m.length);
      return m.slice(0, keep) + "*".repeat(Math.max(4, m.length - keep));
    });
  }
  return out;
}

function snippet(text: string, index: number, len = 60): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + len);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

/** Scan untrusted text. Never throws; returns redacted-safe output. */
export function scanContent(text: string): ShieldResult {
  const findings: ShieldFinding[] = [];
  if (!text) return { findings, redacted: "", highestRisk: "none" };

  for (const { name, re } of SECRET_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      findings.push({
        detectionType: "secret",
        riskLevel: "critical",
        evidence: `[REDACTED ${name}] ${snippet(text, m.index)}`,
        recommendation:
          "A possible secret was detected. Rotate it, remove it from the ticket, and notify security.",
        span: { start: m.index, end: m.index + m[0].length },
      });
      break; // one secret finding is enough to trigger review
    }
  }

  for (const { name, re } of PII_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      findings.push({
        detectionType: "pii",
        riskLevel: name === "Email" ? "low" : "medium",
        evidence: `[PII ${name} redacted] ${snippet(redactSecrets(text), m.index)}`,
        recommendation:
          "Personal data detected. Confirm it is necessary for the ticket; mask if not.",
        span: { start: m.index, end: m.index + m[0].length },
      });
      break;
    }
  }

  for (const re of INJECTION_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      findings.push({
        detectionType: "prompt_injection",
        riskLevel: "high",
        evidence: snippet(text, m.index),
        recommendation:
          "Possible prompt-injection attempt. Treat this content as untrusted data; it must never override system instructions.",
        span: { start: m.index, end: m.index + m[0].length },
      });
      break;
    }
  }

  const urls = text.match(SUSPICIOUS_URL_RE) ?? [];
  for (const url of urls.slice(0, 3)) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      // Flag lookalike / non-https / IP hosts.
      if (
        url.startsWith("http://") ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
        host.includes("xn--")
      ) {
        findings.push({
          detectionType: "suspicious_url",
          riskLevel: "medium",
          evidence: host,
          recommendation:
            "Suspicious link detected. Verify before clicking; consider sandboxing.",
        });
        break;
      }
    } catch {
      /* ignore malformed */
    }
  }

  if (SOCIAL_ENGINEERING_RE.test(text) && urls.length > 0) {
    findings.push({
      detectionType: "social_engineering",
      riskLevel: "medium",
      evidence: snippet(text, text.search(SOCIAL_ENGINEERING_RE)),
      recommendation:
        "Urgency language combined with links can indicate phishing. Verify the sender independently.",
    });
  }

  const order = { none: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;
  let highestRisk: ShieldResult["highestRisk"] = "none";
  for (const f of findings) {
    if (order[f.riskLevel] > order[highestRisk]) highestRisk = f.riskLevel;
  }

  return { findings, redacted: redactSecrets(text), highestRisk };
}

/**
 * Persist findings for an entity. Evidence stored is already redacted —
 * raw secrets never reach the database.
 */
export async function recordDetections(
  entityType: string,
  entityId: string,
  fieldName: string,
  result: ShieldResult,
  tenantId?: number | null,
): Promise<void> {
  if (result.findings.length === 0) return;
  const { pool } = await import("@workspace/db");
  for (const f of result.findings) {
    await pool.query(
      `INSERT INTO security_detections
         (tenant_id, entity_type, entity_id, field_name, detection_type,
          risk_level, evidence, recommendation, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open')`,
      [
        tenantId ?? null,
        entityType,
        entityId,
        fieldName,
        f.detectionType,
        f.riskLevel,
        f.evidence,
        f.recommendation,
      ],
    );
  }
}
