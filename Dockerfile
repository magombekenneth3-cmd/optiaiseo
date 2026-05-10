

FROM node:20-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@8.15.1 --prefer-online

# ── fetch: warm the pnpm content-addressable store ───────────────────────────
FROM base AS fetch
WORKDIR /app
# Prevents onnxruntime-node postinstall from trying to download CUDA
# binaries from github.com (blocked in restricted Docker DNS environments).
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY .npmrc pnpm-lock.yaml ./
RUN \
    pnpm fetch

# ── deps: install packages + generate Prisma client ──────────────────────────
FROM fetch AS deps
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY .npmrc package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN \
    NODE_OPTIONS="--max-old-space-size=2048" \
    pnpm install --frozen-lockfile --offline && \
    pnpm exec prisma generate && \
    cp -rL node_modules/@prisma/client /tmp/prisma-client-real

# ── builder: compile Next.js ──────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_DISABLE_TYPESCRIPT_CHECKING=1
ENV NEXT_DISABLE_OPTIMIZED_FONTS=1
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
# Prevent Sentry's webpack plugin from uploading / processing source maps
# during the Docker build. Source-map upload runs in the webpack compilation
# worker and holds every map file in the Node heap simultaneously, which OOMs
# the builder at ~4 GB. Maps can be uploaded from a dedicated CI step instead.
ENV SENTRY_DISABLE_SOURCE_MAP_UPLOAD=1

ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}
ARG UPSTASH_REDIS_REST_URL
ENV UPSTASH_REDIS_REST_URL=${UPSTASH_REDIS_REST_URL}
ARG NEXTAUTH_URL
ENV NEXTAUTH_URL=${NEXTAUTH_URL}
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ARG LIVEKIT_URL
ENV LIVEKIT_URL=${LIVEKIT_URL}

# NOTE: Secrets (UPSTASH_REDIS_REST_TOKEN, NEXTAUTH_SECRET, GEMINI_API_KEY,
# LIVEKIT_API_KEY, LIVEKIT_API_SECRET) are NOT passed as build ARGs.
# SKIP_ENV_VALIDATION=1 suppresses runtime validation during build.
# All secrets are injected by Railway at runtime via environment variables.

COPY . .

RUN rm -f next.config.ts.timestamp || true
RUN pnpm exec prisma generate

# pnpm symlinks break Node's module resolution for @prisma/client -> .prisma/client
# inside Next.js worker threads in Docker. Unrolling it to a regular folder guarantees it works.
RUN cp -rL node_modules/@prisma/client /tmp/client-real && \
    rm -rf node_modules/@prisma/client && \
    mv /tmp/client-real node_modules/@prisma/client

RUN pnpm run build

# Compile custom server.ts to server.js
# next-auth/jwt is imported by server.ts for WebSocket auth — it must be bundled
# because the runner stage node_modules only contains @prisma/client (explicit copy)
# and the Next.js standalone minimal set (which does NOT include next-auth).
# Only 'next' and '@prisma/client' are safe to keep external.
RUN pnpm exec esbuild server.ts \
    --bundle \
    --platform=node \
    --external:next \
    --external:@prisma/client \
    --external:.prisma/client \
    --outfile=server.js

# ── agent-bundle: esbuild the LiveKit agent ───────────────────────────────────
FROM builder AS agent-bundle
RUN pnpm exec esbuild livekit-agent.ts \
    --bundle \
    --platform=node \
    --packages=external \
    --outfile=livekit-agent.js

# ── runner: minimal production image ─────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Give the nodejs user a writable HOME so tools like Playwright that write to
# ~/.cache don't crash with "Executable doesn't exist at /nonexistent/..." errors.
ENV HOME=/app
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
RUN mkdir -p /app/.cache && chown -R nextjs:nodejs /app/.cache

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

COPY --from=deps   --chown=nextjs:nodejs /app/prisma            ./prisma

COPY --from=builder      --chown=nextjs:nodejs /app/server.js        ./server.js
COPY --from=agent-bundle --chown=nextjs:nodejs /app/livekit-agent.js ./livekit-agent.js

RUN mkdir -p ./node_modules/.prisma ./node_modules/@prisma
COPY --from=deps /app/node_modules/.prisma/client  ./node_modules/.prisma/client
COPY --from=deps /tmp/prisma-client-real           ./node_modules/@prisma/client

# Copy Puppeteer Chrome binary so PDF generation works at runtime
COPY --from=deps --chown=nextjs:nodejs /root/.cache/puppeteer /app/.cache/puppeteer

RUN npm install -g tsx prisma@5.22.0 --prefer-online

# Startup script: run migrations then start the server
RUN printf '#!/bin/sh\nset -e\necho "[Startup] Running Prisma migrations..."\nprisma migrate deploy\necho "[Startup] Starting server..."\nexec node server.js\n' > /app/start.sh && chmod +x /app/start.sh

USER nextjs
EXPOSE 3000

# Health check: wait up to 60s for the app to respond on /
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

CMD ["/bin/sh", "/app/start.sh"]