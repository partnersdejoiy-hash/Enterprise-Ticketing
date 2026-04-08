# OrbitDesk - Enterprise Ticketing System

## Overview

Full-stack enterprise ticketing SaaS platform for large organizations. Similar to Zendesk/Freshdesk but built for internal enterprise operations. Supports departments: IT, HR, BGV, Admin, Legal, Finance, Operations, Customer Support.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React 18, Vite, TailwindCSS, ShadCN UI, Framer Motion, Recharts
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **State management**: Zustand
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/scripts run seed` — seed the database with demo data

## Architecture

### Frontend (`artifacts/orbitdesk/`)
- React + Vite SPA at path `/`
- Auth via localStorage token + Zustand store
- Pages: Login, Dashboard, Tickets, TicketDetail, CreateTicket, Departments, Users, Settings, Documents, Training, AutomationRules
- Login page: colorful geometric Bauhaus-style SVG shapes in corners (Dejoiy brand colors)
- Sidebar: "D" Dejoiy badge on logo, Automation Rules with AUTO badge, Training Centre
- All API calls via `@workspace/api-client-react` generated hooks
- Deep Indigo/Navy color palette (enterprise professional)

### Backend (`artifacts/api-server/`)
- Express 5 API server at path `/api`
- Routes: auth, tickets, departments, users, dashboard stats, email, permissions, settings, automationRules
- Simple token-based auth (base64url encoded user ID)
- Password hashing with SHA-256 + salt
- IMAP polling service applies automation rules to incoming emails

### Database (`lib/db/`)
- Tables: users, departments, tickets, ticket_comments, ticket_history, system_settings, role_permissions, automation_rules
- `automation_rules`: id, name, description, isActive, triggerType, conditions (JSONB), actions (JSONB), conditionLogic, priority, createdById
- Enums: role, ticket_status, ticket_priority

### Automation Rules Engine
- Rules defined in DB, applied at IMAP poll time and on ticket creation
- Conditions: from_email, to_email, subject, body, tag, department, priority
- Operators: contains, not_contains, equals, starts_with, ends_with, matches_regex
- Actions: set_department, set_priority, set_status, assign_agent, add_tag, send_notification, set_raised_for
- Condition logic: AND / OR
- Super admin UI at /automation-rules

### Deployment
- `vercel.json` for Vercel deployment
- `Dockerfile` for Docker/AWS/Hostinger deployment
- `DEPLOYMENT.md` with detailed deployment guides for all platforms

## Demo Credentials
- **Super Admin (Deepak Sharma)**: deepak.sharma@dejoiy.com / Jaymaakaali@321
- **Admin**: admin@dejoiy.com / Jaymaakaali@321
- **Agent (IT)**: alex.c@company.com / password
- **HR Manager**: fatima.h@company.com / password

## Modules Implemented
1. Authentication (login/logout/session)
2. Role-based access (super_admin, admin, manager, agent, employee, external)
3. Ticket CRUD with status, priority, SLA tracking
4. Department management (8 departments)
5. User management with bulk role assignment and employee ID management
6. Dashboard analytics (stats, dept breakdown, agent performance, SLA overview)
7. Ticket conversation thread (public + internal notes)
8. Ticket history timeline
9. SLA breach detection and display
10. Role Permissions Management (per-role capability toggles)
11. CSV Bulk Import (users)
12. Document Request Portal (HR documents via ticket flow)
13. Email Notifications: SMTP config (editable by super admin in Settings), auto-emails on ticket create/resolve/close/document-request
14. Employee ID field on users (display in table, "Set Employee ID" dialog in user dropdown)
15. "Raising for" CC field on tickets (Myself / Someone Else toggle with employee ID lookup)
16. system_settings DB table for key-value configuration (SMTP, toggles)
17. Full mobile responsiveness
18. Forgot Password flow — login page "Forgot password?" link opens dialog; submits email → auto-creates IT ticket tagged `password-reset`; both servers support `POST /api/auth/forgot-password`
19. Password reset by admin — "Reset Password" dropdown item in Users page (visible to super_admin, admin, IT dept); opens dialog with new/confirm password fields; calls `PATCH /api/users/:userId` with `newPassword`
20. Quick ticket templates — Create Ticket page has "Work From Home Request" and "Password Reset Request" pill buttons that pre-fill subject, description, priority, tags, and department

## DB Schema Additions
- `users.employee_id` — optional unique employee identifier (partial unique index)
- `tickets.raised_for_name`, `tickets.raised_for_email` — CC/on-behalf-of fields
- `system_settings` table — key/value store for SMTP and email config
- `role_permissions` table — per-role feature capability flags
