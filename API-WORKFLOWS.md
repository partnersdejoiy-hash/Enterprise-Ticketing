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

## Saved settings, routing and Orbit assistant

- `GET/PUT /api/settings/workspace/me`: authenticated user's name and notification preferences. Each panel saves independently; email and roles cannot be changed here. Preferences are durable `system_settings` JSON records keyed by user ID. Daily digests are explicitly disabled until a scheduler exists.
- `GET/PUT /api/settings/workspace/routing`: admins only. Persist auto-assignment, automation enablement and BGV/employment team mappings. Existing explicit environment mappings are defaults; unique exact department names are the fallback. An explicitly saved `null` means admin triage, never an environment fallback. Existing tickets are not moved when settings change.
- The 12-rule starter pack is installed transactionally on first automation execution or rules-page visit. A durable version marker prevents reinstating deleted defaults. Disabled rules stay disabled. Only active rules owned by active admins execute.
- Events: ticket creation, incoming email and ticket updates (including comments). Literal conditions only; priority, custom queue tags and assignment within the current handling team are supported. Source/authorization tags are protected. Rule order is stable; first matching priority/tag action wins. History records applied changes. Resolved/closed tickets are untouched.
- Assignment uses a per-department PostgreSQL advisory lock and the smallest active ticket workload among active agents/managers. Employees, inactive users and other teams are excluded. No eligible handler leaves the team queue unassigned. `POST /api/automation-rules/run-unassigned` lets an admin process up to 100 active unassigned tickets with eligible handlers, without changing their handling departments.
- New unclassified general requests use a local TF-IDF prototype classifier (department names/descriptions and the versioned BPO vocabulary in `team-classifier.ts`). A minimum score, separation margin and two matched terms are required; uncertain requests stay in admin triage. These scores are similarity scores, not calibrated probabilities. Explicit team selections and structured BGV/EV type mappings take precedence. No external inference request is made and ticket history is not used for training.
- `POST /api/assistant/team-suggestion` requires authentication and only returns a draft suggestion. It does not create or move tickets. The chat assistant has no ticket lookup, file, email, approval or permission-changing tools.
- Orbit offers a workflow guide plus opt-in Qwen2.5-0.5B-Instruct via WebLLM in a dedicated browser worker. Model download starts only after Enable local AI. WebGPU, roughly 1 GB GPU memory and access to Hugging Face/MLC model hosting are needed. Model-load failures leave the guide and team suggestions available. Chats stay in page memory and are rendered as text; model output is never executed. Stop local AI terminates the worker and clears the conversation. Model files may remain cached. No paid AI API or server GPU is provisioned.
- Assignment/comment/SLA-review notifications honor per-user preferences and recheck ticket access; internal-reply notices only reach handlers. Notices contain a ticket reference and secure link, not HR evidence or comment text. Status email preferences apply to known app users. Delivery requires a configured provider. SLA review is event-based, not a scheduled timer; email failure does not undo a saved ticket.

Reference implementations: https://webllm.mlc.ai/docs/user/basic_usage.html and https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct (Apache-2.0 model).
