FROM node:20-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@8.15.1 --prefer-online

FROM base AS fetch
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY .npmrc pnpm-lock.yaml ./
RUN pnpm fetch

FROM fetch AS deps
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY .npmrc package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN NODE_OPTIONS="--max-old-space-size=2048" \
    pnpm install --frozen-lockfile --offline && \
    pnpm exec prisma generate && \
    cp -rL node_modules/@prisma/client /tmp/prisma-client-real

FROM fetch AS builder
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_DISABLE_TYPESCRIPT_CHECKING=1
ENV NEXT_DISABLE_OPTIMIZED_FONTS=1
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

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN rm -f next.config.ts.timestamp || true
RUN pnpm exec prisma generate
RUN cp -rL node_modules/@prisma/client /tmp/client-real && \
    rm -rf node_modules/@prisma/client && \
    mv /tmp/client-real node_modules/@prisma/client
RUN pnpm run build

FROM builder AS agent-bundle
RUN pnpm exec esbuild livekit-agent.ts \
    --bundle \
    --platform=node \
    --packages=external \
    --outfile=livekit-agent.js

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV HOME=/app
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

RUN mkdir -p /app/.cache && chown -R nextjs:nodejs /app/.cache

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts          ./scripts

COPY --from=deps    --chown=nextjs:nodejs /app/prisma           ./prisma
COPY --from=agent-bundle --chown=nextjs:nodejs /app/livekit-agent.js ./livekit-agent.js

RUN mkdir -p ./node_modules/.prisma ./node_modules/@prisma
COPY --from=deps /app/node_modules/.prisma/client  ./node_modules/.prisma/client
COPY --from=deps /tmp/prisma-client-real           ./node_modules/@prisma/client

COPY --from=deps --chown=nextjs:nodejs /root/.cache/puppeteer /app/.cache/puppeteer

RUN npm install -g prisma@5.22.0 --prefer-online

RUN chmod +x /app/scripts/start.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

CMD ["/bin/sh", "/app/scripts/start.sh"]