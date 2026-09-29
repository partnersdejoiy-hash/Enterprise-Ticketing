import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

// Public identifiers, not credentials. Trust only this production workload.
export const BUSINESS_SITE_IDENTITY = Object.freeze({
  issuer: "https://oidc.vercel.com/dejoiy",
  audience: "https://vercel.com/dejoiy",
  subject: "owner:dejoiy:project:dejoiy-site:environment:production",
  ownerId: "team_aXAejKB3uRauTLTZ7C4J4t0c",
  projectId: "prj_pg7CXv2fBCO86UrTGgFBk1PLhdcS",
});
const keys = createRemoteJWKSet(new URL("https://oidc.vercel.com/dejoiy/.well-known/jwks"), {
  timeoutDuration: 5000,
  cooldownDuration: 30000,
  cacheMaxAge: 600000,
});
export function businessSiteOidcEnabled(env = process.env) {
  return env.VERCEL === "1" && env.VERCEL_ENV === "production";
}
export async function verifyBusinessSiteIdentity(token: string, keySet: JWTVerifyGetKey = keys) {
  const expected = BUSINESS_SITE_IDENTITY;
  const { payload } = await jwtVerify(token, keySet, {
    algorithms: ["RS256"],
    issuer: expected.issuer,
    audience: expected.audience,
    subject: expected.subject,
    requiredClaims: ["exp", "iat", "nbf", "owner_id", "project_id", "environment"],
    maxTokenAge: "1h",
    clockTolerance: 5,
  });
  for (const [claim, value] of Object.entries({ owner_id: expected.ownerId, project_id: expected.projectId,
    environment: "production", owner: "dejoiy", project: "dejoiy-site" })) {
    if (payload[claim] !== value) throw Object.assign(new Error("Untrusted workload identity"), { code: "IDENTITY_CLAIM_MISMATCH", claim });
  }
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number" || payload.exp - payload.iat > 3600)
    throw Object.assign(new Error("Invalid identity lifetime"), { code: "IDENTITY_LIFETIME" });
}
