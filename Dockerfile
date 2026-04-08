FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/orbitdesk/package.json ./artifacts/orbitdesk/
COPY lib/db/package.json ./lib/db/
COPY packages/ ./packages/ 2>/dev/null || true
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=deps /app/artifacts/orbitdesk/node_modules ./artifacts/orbitdesk/node_modules
COPY --from=deps /app/lib/db/node_modules ./lib/db/node_modules
COPY . .
RUN pnpm --filter @workspace/db build 2>/dev/null || true
RUN pnpm --filter @workspace/api-server run build
RUN pnpm --filter @workspace/orbitdesk run build

FROM node:20-alpine AS runner
RUN npm install -g pnpm@9
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/artifacts/api-server/dist ./api-server/dist
COPY --from=builder /app/artifacts/api-server/package.json ./api-server/
COPY --from=builder /app/artifacts/orbitdesk/dist ./orbitdesk/dist
COPY --from=builder /app/lib/db/dist ./lib/db/dist 2>/dev/null || true

WORKDIR /app/api-server
RUN pnpm install --prod 2>/dev/null || npm install --production

EXPOSE 8080
ENV PORT=8080

CMD ["node", "dist/index.js"]
