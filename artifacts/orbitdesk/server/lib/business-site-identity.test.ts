import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from "jose";
import { BUSINESS_SITE_IDENTITY as expected, verifyBusinessSiteIdentity, businessSiteOidcEnabled } from "./business-site-identity.js";

test("only the exact signed DEJOIY production workload can submit intake", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keySet = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test-only" }] });
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: expected.issuer, aud: expected.audience, sub: expected.subject,
    owner_id: expected.ownerId, project_id: expected.projectId,
    owner: "dejoiy", project: "dejoiy-site", environment: "production",
    iat: now, nbf: now, exp: now + 3600,
  };
  const sign = (changes = {}) => new SignJWT({ ...claims, ...changes })
    .setProtectedHeader({ alg: "RS256", kid: "test-only" }).sign(privateKey);
  await verifyBusinessSiteIdentity(await sign(), keySet);
  for (const changes of [
    { iss: "https://oidc.vercel.com/other" }, { aud: "https://vercel.com/other" },
    { sub: "owner:dejoiy:project:dejoiy-site:environment:preview" },
    { owner_id: "team_other" }, { project_id: "prj_other" },
    { owner: "other" }, { project: "other" }, { environment: "preview" },
    { exp: now - 60 }, { nbf: now + 60 }, { iat: now - 7200 },
    { iat: now - 3610, exp: now + 7200 }, { exp: undefined }, { project_id: undefined },
  ]) await assert.rejects(verifyBusinessSiteIdentity(await sign(changes), keySet));
  // Longer issuer lifetime cannot bypass our independently enforced age cap.
  await verifyBusinessSiteIdentity(await sign({ exp: now + 7200 }), keySet);
  const forged = await generateKeyPair("RS256");
  await assert.rejects(verifyBusinessSiteIdentity(await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-only" }).sign(forged.privateKey), keySet));
  await assert.rejects(verifyBusinessSiteIdentity("not-a-token", keySet));
  assert.equal(businessSiteOidcEnabled({ VERCEL: "1", VERCEL_ENV: "production" }), true);
  assert.equal(businessSiteOidcEnabled({ VERCEL: "1", VERCEL_ENV: "preview" }), false);
  assert.equal(businessSiteOidcEnabled({}), false);
});
