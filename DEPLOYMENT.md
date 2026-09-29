# DEJOIY OrbitDesk deployment

OrbitDesk has no per-seat licence or required paid automation subscription. Self-hosting still requires a server, a domain/TLS setup and backups. An already-paid server can avoid an additional hosting subscription; unlimited free managed hosting is not promised.

## Release gate

This release changes authentication and adds session/intake tables, reporting relationships and an access-change audit table. Back up PostgreSQL, apply the additive migration, reset any password previously published in this repository, then deploy. Existing sessions are intentionally invalidated. Do not deploy the app before the migration.

The repository previously contained example passwords and unsigned tokens. Removing the text does not remove it from Git history. Rotate those credentials on every system where they were reused. The application refuses the previously published demo passwords.

## One supported application

- React/Vite frontend: `artifacts/orbitdesk/src`
- Canonical Express backend: `artifacts/orbitdesk/server`
- Node bundle entry point: `artifacts/api-server/src/index.ts`
- Vercel adapter: `api/index.ts`
- PostgreSQL/Drizzle schema: `lib/db/src/schema`

Both server entry points use the canonical backend. Node 22 or 24 and pnpm 11.25.0 are supported. Run commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
PORT=8080 NODE_ENV=production node artifacts/api-server/dist/index.mjs
```

Supply environment variables through your host's secret manager. `DATABASE_URL` is required. `APP_ORIGIN` must be the exact public HTTPS origin (without a trailing slash). Do not use `VITE_` prefixes for secrets. Frontend and API must share the same origin because authentication uses a host-only HttpOnly cookie.

`pnpm db:migrate` creates the initial schema only on an empty database and then applies `001_secure_intake.sql` and `002_hierarchy.sql`. It never drops existing data. For an existing installation, review and apply the additive migration during maintenance. The migrations add session records, durable rate limits, intake receipts, reporting relationships, ticket participants, access history and indexes. Existing users are marked for a one-time password change; repeating the migration does not reset users who already changed it.

## Existing server with Docker

Copy `.env.example` to `.env` on the server and fill the values privately. Use a URL-safe random `POSTGRES_PASSWORD` (or percent-encode it when constructing a connection URL). `compose.yaml` keeps PostgreSQL private and binds the web service to loopback behind your existing HTTPS reverse proxy.

```sh
docker compose build
docker compose up -d db
docker compose run --rm app pnpm db:migrate
docker compose up -d app
```

Proxy your chosen HTTPS domain to `127.0.0.1:8080`, pass `Host` and `X-Forwarded-Proto`, restrict the upstream to your reverse proxy, and configure backups of the `orbitdesk-db` volume. Set `APP_ORIGIN` before accepting traffic. Never expose PostgreSQL to the public Internet.

Create the first administrator only if there are no existing administrator accounts. Supply `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` and a unique `BOOTSTRAP_ADMIN_PASSWORD` of at least 16 characters in the server environment, then run `pnpm --filter @workspace/scripts seed`. For this workspace, the authorised bootstrap email is `deepak.sharma@dejoiy.com` and name is `Deepak Sharma`. Supply the agreed temporary password privately on the server; it is not stored in this repository. The script never creates sample people or changes existing accounts. First login is password-change-only, including for superadmins.

For a known existing account, an authorised server operator can provide `RESET_USER_EMAIL` and `RESET_USER_PASSWORD`, then run `pnpm --filter @workspace/scripts exec tsx src/reset-password.ts`. This changes only the matching password, requires a new password at next login and revokes its sessions; it does not change roles. Remove temporary bootstrap/reset variables after use.

## Connect business.dejoiy.com

The DEJOIY Vercel production projects use existing Vercel OIDC workload identity; no shared secret needs to be copied. The receiver pins the DEJOIY team ID, `dejoiy-site` project ID, issuer, audience, subject and production environment in `server/lib/business-site-identity.ts`. It verifies RS256 signatures against Vercel's fixed JWKS URL, expiry, issued-at and not-before. Preview projects and other teams/projects are rejected. This grants only intake submission, never staff or ticket-reading access. Tokens stay server-side and are never logged. The sender only sends this identity to `https://orbitdesk-dejoiy.vercel.app` and refuses redirects.

On another host, configure the shared-secret alternative below. An invalid bearer token never falls back to HMAC.

On the OrbitDesk server:

| Variable                                | Purpose                                                   |
| --------------------------------------- | --------------------------------------------------------- |
| `BUSINESS_SITE_INTAKE_SECRET`           | Optional HMAC alternative outside Vercel; at least 32 characters |
| `EMPLOYMENT_VERIFICATION_DEPARTMENT_ID` | Existing approved department ID; optional                 |
| `BGV_DEPARTMENT_ID`                     | Existing approved BGV department ID; optional             |

On the BPO website server:

| Variable                  | Value                                                       |
| ------------------------- | ----------------------------------------------------------- |
| `ORBITDESK_URL`           | OrbitDesk's public HTTPS origin                             |
| `ORBITDESK_INTAKE_SECRET` | Only for HMAC: same secret as `BUSINESS_SITE_INTAKE_SECRET`                |
| `ORBITDESK_ENABLED`       | `true` only after both deployments and verification succeed |
| `VERIFICATION_TO_EMAIL`   | `employment-verification@dejoiy.com`                        |
| `BGV_TO_EMAIL`            | `bgv@dejoiy.com`                                            |

The website validates the form, authenticates with the production workload token (or signs the exact JSON body using HMAC-SHA256 when a shared key is configured) and sends it server-to-server to `POST /api/integrations/business-site/verification`. OrbitDesk checks the workload identity or HMAC signature/five-minute timestamp window, then the rate limit, request type, consent and PDF contents. A transaction saves the ticket, its authorisation file, audit entry and idempotency receipt. Only then does the website show a `DJ-EV-…` or `DJ-BGV-…` ticket reference.

The same request UUID and body return the same ticket; changed content with the same UUID returns 409. A timeout should be retried without changing the request. Failed storage never reports success. Notification failure after storage is reported separately; the ticket remains saved. Website notification emails include the reference, not employee details or the authorisation file. The original email-only flow remains available while `ORBITDESK_ENABLED` is absent/false.

BGV uses the existing `bgv-request` tag. Employment uses `employment-verification`. Both carry `business-website` and `authorisation-review-required`. Department routing never creates permissions or users. Without an explicit department ID, tickets are unassigned and visible only to existing administrators. Confirm the department's membership before configuring it. Requests are assigned to the active agent/manager in that department with the fewest active tickets, using a transaction-level department lock. If no eligible agent exists, they stay in that department's unassigned queue. No account is inferred or created from a public form. A submission does not verify the requester or authorise releasing employee data; staff must review the evidence and independently validate the requester.

The staff Integration page reports configuration and receipts without revealing the key. The website has no new sign-in requirement.

## Security and operating limits

- Random 256-bit server-side sessions, hashed at rest, eight-hour expiry, revocation on logout/password change and current active-user checks.
- HttpOnly, SameSite=Strict, Secure cookies in production. No credential tokens are returned to browser storage.
- Scrypt with random salts for new passwords; eligible legacy hashes upgrade at login. Published demo passwords are rejected.
- Administrators see all requests. Other users see their created, explicitly linked/tagged and assigned tickets. Reporting supervisors inherit tickets for their direct and indirect reports. Agents/managers also handle requests routed to their department. Team labels alone grant no access. Source authorisation PDFs and internal comments are restricted to administrators and the handling team, even when a reporting manager or employee can see the ticket.
- Uploaded authorisations are restricted to PDFs up to 2 MB and remain in private PostgreSQL storage. Signature/type checks are not malware scanning. Review attachments in your organisation's approved viewer; keep evidence out of public buckets.
- Source authorisations cannot be forwarded using the general attachment-email action. Resolution status is not a BGV pass/fail decision. No employee eligibility decisions are automated.
- Back up records, define retention with HR, monitor storage and rotate integration credentials. Base64 increases file storage by about a third. Database free tiers are finite.
- The public generic request form and login use persistent request limits. Configure your reverse proxy's trusted forwarding chain; arbitrary forwarded IP headers must not be accepted.
- Periodically remove expired session/rate-limit rows (`pnpm --filter @workspace/scripts exec tsx src/maintenance.ts`). This does not delete tickets or HR files.

## Hosting

No paid services were added. The Docker/Node path uses your existing server and PostgreSQL. SMTP can use an existing authorised mailbox; website notifications continue through its existing Resend setup. IMAP polling is opt-in on a long-running server, separate from instant website intake.

Vercel Hobby is restricted to personal, non-commercial usage. Commercial deployment requires an eligible plan. The former two-minute cron is removed; no background polling is needed for website intake. Do not treat removal of the cron as permission to use a commercial app on Hobby. An existing Vercel adapter remains available for an eligible plan, with repository root as Root Directory, `pnpm build:vercel`, and the same PostgreSQL/secret configuration. The build emits Vercel Build Output API v3 files in `.vercel/output`: static assets plus a self-contained Node 24 function. Workspace TypeScript and npm dependencies are bundled to avoid missing pnpm symlinks at runtime. Run `pnpm test:vercel` after building to verify the function in isolation. Missing `DATABASE_URL` returns a JSON 503 setup error; it does not mean login is operational. Connect the database to the deployment environment, run migrations and bootstrap the admin before enabling intake. A Production-only database connection will not configure Preview deployments.

Sources checked 29 September 2026: https://vercel.com/docs/plans/hobby and https://vercel.com/docs/cron-jobs/usage-and-pricing. Neon Free currently lists 0.5 GB storage/project and 100 CU-hours/project/month: https://neon.com/pricing.

## Verification

### One-time Vercel administrator bootstrap

After applying migrations to the connected OrbitDesk database, set `ORBITDESK_BOOTSTRAP_ADMIN=true`, `BOOTSTRAP_ADMIN_EMAIL` and optionally `BOOTSTRAP_ADMIN_NAME` on the intended deployment environment. Enter `BOOTSTRAP_ADMIN_PASSWORD` as a sensitive environment variable (at least 16 characters), then redeploy the reviewed branch. The build runs the existing seed script, which hashes the password, requires a change on first login, and refuses to overwrite an existing account. Remove the bootstrap flag and password after the successful build, then redeploy again. Never enable the bootstrap flag for unrelated projects or branches. No credentials are included in the frontend or committed code.

```sh
pnpm typecheck
pnpm build
pnpm test
```

Tests use an isolated PostgreSQL-compatible test database, synthetic requests and fake email delivery. They never touch production mailboxes or data. Browser verification is available with `pnpm test:browser`; set `BROWSER_EXECUTABLE_PATH` only when your runner supplies Chromium separately.

## Reporting and account setup

| Person                   | Ticket visibility                                                                           | People administration                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Superadmin / admin       | All tickets; department filter; Raised by me                                                | Manage users, roles, departments, reporting manager and team label; admins cannot change superadmins |
| Handling agent / manager | Own, linked/tagged, assigned, reporting-team tickets and tickets routed to their department | No general directory administration                                                                  |
| Reporting supervisor     | Direct and indirect reports' created, linked and tagged tickets                             | No additional administration from hierarchy alone                                                    |
| Employee                 | Own created, explicitly raised-for and tagged tickets                                       | None                                                                                                 |
| IT agent / manager       | Same ticket rules; IT membership does not expose all HR records                             | Change non-admin users' department, manager, team label and temporary password; cannot promote roles |
| External account         | Own created/explicitly linked tickets; no employee directory                                | None                                                                                                 |

IT administration requires an agent/manager role in a department named `IT`, `IT Support` or `Information Technology`. It never applies to every employee in that department. Set real reporting managers under **Users → Manage**; circular relationships are rejected and changes are recorded in `user_access_history`. Deactivate users instead of deleting historical identities.

For the BGV example, create or locate the real Raghvi account, set an appropriate handling role (Agent or Manager), assign the approved BGV department, and configure that department's ID for website intake. Link her team members using their Reporting manager field. Her queue then includes BGV requests, her own/linked requests and her reports' linked requests. This release does not invent her email or create a fake employee record.

For existing tickets, handling staff can explicitly select **Raised for an employee** and **Tagged employees**. Free-text names, CC addresses and the external verification requester's business email never grant employee account access. Review identity before linking a public verification request to an employee. Existing free-text tickets are not silently matched by name.

New accounts, bulk-imported users and password resets require a first-login password change. Until that succeeds, the API returns `428 PASSWORD_CHANGE_REQUIRED` for workspace routes; changing the URL cannot bypass the gate. Changing a password ends all existing sessions and requires sign-in with the new password. Privileged roles obey this flow too.

Existing action permissions can narrow create/assign/close/delete/bulk abilities. Ticket visibility remains bounded by the above relationships: a legacy `canViewAllTickets` flag on a lower role does not make confidential records globally visible. Only admins/superadmins have global visibility.

## Release verification and rollback

Run `BPO_SITE_ROOT=../dejoiy-site pnpm test` to include the real BPO form handler → signed receiver → database path, with fake mail delivery. Tests cover duplicate submissions, private evidence, first-login enforcement, hierarchy changes, tagged employees, IT restrictions and session revocation. Browser tests cover desktop/mobile queues, user-manager editing and the forced password-change journey.

Keep `ORBITDESK_ENABLED=false` on the website until the intended server is migrated, the requested superadmin is provisioned, department membership is reviewed and one authorised test submission is verified. The existing-server choice still needs the actual hostname and deployment access. Multiple Vercel projects in the account must not be treated as the production app without confirmation.

Take a database backup before migration. The schema changes are additive; if app rollout fails, stop intake and restore the previous application only with a reviewed authentication rollback plan (the prior unsigned-token code is not safe to restore publicly). Never drop intake receipts or authorisation files as a rollback shortcut.
