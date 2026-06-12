# Multi-stage Dockerfile for Nut Analytics (Next.js 15 + better-sqlite3)
# Produces a small production image. Requires a persistent volume for /app/data.

# ---- Base with build tools (needed for better-sqlite3 native module) ----
FROM node:20-alpine AS base
WORKDIR /app

# Install build dependencies for native modules (better-sqlite3) then clean up in runner
RUN apk add --no-cache python3 make g++ libc6-compat

# ---- Dependencies ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Enable standalone output (already set in next.config.ts)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runner (minimal) ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Important: the app expects data/ on a persistent volume
ENV ANALYTICS_DB_PATH=/app/data/analytics.db

# su-exec lets the entrypoint drop from root to the app user after fixing
# volume ownership (a mounted volume arrives owned by root at runtime, so a
# build-time chown cannot cover it).
RUN apk add --no-cache su-exec && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy only what is needed from the standalone build
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --chmod=755 docker-entrypoint.sh ./

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app

EXPOSE 3000

# Simple healthcheck (uses the /api/health endpoint; respects $PORT)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Starts as root, chowns the volume, then drops to the nextjs user.
ENTRYPOINT ["/app/docker-entrypoint.sh"]