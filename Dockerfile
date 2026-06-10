# --- Stage 1: install deps & build everything ------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# system deps for argon2 native build (fallback if no prebuilt binary)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Copy the rest of the source.
COPY tsconfig.json tsconfig.server.json ./
COPY drizzle.config.ts ./
COPY src ./src
COPY migrations ./migrations
COPY public ./public
COPY index.html ./
COPY vite.config.ts ./

# Build the server (emits dist-server) and the client (emits dist).
RUN npm run build

# --- Stage 2: minimal runtime image ---------------------------------------
FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Drop to a non-root user.
RUN groupadd --system app && useradd --system --gid app --home /app --shell /usr/sbin/nologin app

WORKDIR /app

# Copy the built artifacts and the production dependencies.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Runtime dependencies for argon2 (libstdc++ is shipped with the
# node:20-bookworm-slim base image; nothing extra needed).
USER app

EXPOSE 3000

# Health check via the /api/health endpoint.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist-server/server/index.js"]
