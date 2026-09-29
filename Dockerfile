FROM node:22-bookworm-slim AS build
RUN npm install -g pnpm@11.25.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim
RUN npm install -g pnpm@11.25.0
WORKDIR /app
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/artifacts/orbitdesk/dist/public
USER node
EXPOSE 8080
CMD ["node", "artifacts/api-server/dist/index.mjs"]
