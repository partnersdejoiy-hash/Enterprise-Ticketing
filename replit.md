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
- Pages: Login, Dashboard, Tickets, TicketDetail, CreateTicket, Departments, Users, Settings
- All API calls via `@workspace/api-client-react` generated hooks
- Deep Indigo/Navy color palette (enterprise professional)

### Backend (`artifacts/api-server/`)
- Express 5 API server at path `/api`
- Routes: auth, tickets, departments, users, dashboard stats
- Simple token-based auth (base64url encoded user ID)
- Password hashing with SHA-256 + salt

### Database (`lib/db/`)
- Tables: users, departments, tickets, ticket_comments, ticket_history
- Enums: role, ticket_status, ticket_priority

## Demo Credentials
- **Super Admin**: admin@orbitdesk.com / password
- **Agent (IT)**: alex.c@company.com / password
- **HR Manager**: fatima.h@company.com / password

## Modules Implemented
1. Authentication (login/logout/session)
2. Role-based access (super_admin, admin, manager, agent, employee, external)
3. Ticket CRUD with status, priority, SLA tracking
4. Department management (8 departments)
5. User management
6. Dashboard analytics (stats, dept breakdown, agent performance, SLA overview)
7. Ticket conversation thread (public + internal notes)
8. Ticket history timeline
9. SLA breach detection and display
