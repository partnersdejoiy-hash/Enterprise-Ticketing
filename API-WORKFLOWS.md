# Account and ticket workflows

All staff endpoints use the production `__Host-orbit_session` cookie (`orbit_session` in development/test). The server stores only its SHA-256 hash. Production cookies are HttpOnly, Secure, SameSite=Strict and expire after eight hours. Browser storage contains an inert `cookie-session` compatibility marker and cached profile, never the session token or password. Database and integration secrets remain server environment variables.

## First login

`POST /api/auth/login` accepts `{ email, password }`, sets the cookie and returns the user, including `mustChangePassword`. When true, `/auth/me`, `/auth/logout` and `/auth/change-password` remain available; other authenticated endpoints return 428. `POST /api/auth/change-password` accepts `{ currentPassword, newPassword }` (12–1024 characters, different from current), verifies the old password, salts and hashes the replacement with scrypt, clears the flag and revokes all sessions atomically. Sign in again afterwards.

## People

`GET /api/directory` provides active internal employee IDs, names and routing details to signed-in internal staff. Filters: `name`, `employeeId`, `departmentId`, `role`; maximum 500 results. External accounts receive no directory results.

`GET/POST /api/users` requires admin/superadmin or a handling agent/manager in the approved IT department. New users require name, email, role and a temporary password. `PATCH /api/users/:id` supports `departmentId`, `managerId`, `teamName`, plus admin-only name/role/employeeId/isActive, and authorised `newPassword` resets. Manager and department IDs are validated; reporting cycles are rejected within a serialised transaction. Account changes are audited without passwords. Admins cannot alter superadmins; IT cannot alter admin accounts or roles. `DELETE` is intentionally rejected: revoke access instead.

## Tickets

`POST /api/tickets` additionally accepts `raisedForUserId: number | null` and `taggedUserIds: number[]` (up to 30 active internal employees). These are authenticated identity links, unlike free-text names/emails. Handling staff can update links with `PATCH /api/tickets/:id`; linked people cannot grant additional access themselves.

`GET /api/tickets` supports `view=mine`, `departmentId`, `unassignedDepartment=true`, `tags`, `status`, `priority`, `search`, `page` and `limit`. All filters intersect the server's visibility scope. `/api/operations` supplies scoped metrics, seven-day counts, recent requests and department counts. Administrators see all; ordinary users inherit their reporting team's ticket relationships and handling agents also see their department's routed work.

Ticket observers can add public replies. Internal comments, source PDFs and ticket mutations require handling-team membership or administration. A reporting relationship alone grants observation, not authority to close a request in another handling department. Per-role action permissions further narrow assignment, closure, deletion and bulk actions.

## Public BPO intake

The public site never calls the ticket database from the browser. Its server validates form fields and the PDF, authenticates using the pinned Vercel production workload identity (or signs the JSON body with a configured shared secret outside Vercel) and posts to `/api/integrations/business-site/verification`. Signature, freshness, consent, shape and file content are validated again. A database transaction creates the dedicated EV/BGV ticket, private file, history and idempotency receipt, then the caller receives the actual ticket reference. A department lock protects least-workload assignment. Reusing the request UUID with identical data returns the same ticket; changed data returns 409. See `DEPLOYMENT.md` for the environment-variable mapping and activation gate.
