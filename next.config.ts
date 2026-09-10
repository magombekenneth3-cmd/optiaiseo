// @sentry/nextjs is loaded dynamically so a missing package never breaks the build.
import type { NextConfig } from "next";
import path from "path";


if (process.env.SKIP_ENV_VALIDATION !== "1") {
  require("./src/lib/env");
}

const nextConfig: NextConfig = {

  output: "standalone",
  compress: true,
  // Fix #9: TypeScript and ESLint errors now correctly fail CI builds.
  // Remove ignoreBuildErrors / ignoreDuringBuilds — broken code must not ship.
  typescript: {},
  eslint: {},


  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "cdn.hashnode.com" },
    ],
  },

  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/.prisma/**/*"],
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "@livekit/components-react",
      "@livekit/components-core",
      "inngest",
    ],
  },


  serverExternalPackages: [
    "@google/genai",
    "ws",
    "prisma",
    "@prisma/client",
    "@prisma/engines",
    // BullMQ uses a dynamic require() in child-processor — keep it external
    // so webpack doesn't try to bundle it and emit a "critical dependency" warning.
    "bullmq",
    "ioredis",
    // OTEL packages are Node-only and lazily imported; keeping them external
    // prevents webpack from tracing into instrumentation-winston which
    // references the missing @opentelemetry/winston-transport peer dep.
    "@opentelemetry/sdk-node",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/auto-instrumentations-node",
    "@opentelemetry/api",
  ],

  productionBrowserSourceMaps: false,

  poweredByHeader: false,

  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      tailwindcss: path.resolve(__dirname, "node_modules/tailwindcss"),
    };

    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/.next/**", "**/node_modules/**"],
    };

    config.module.rules.push({
      test: /node_modules\/@livekit\/components-styles\/.*\.css$/,
      use: 'null-loader',
    });

    // Prevent @upstash/redis from pulling in its nodejs.mjs entry inside the
    // Edge middleware bundle — only the fetch-based HTTP client is Edge-safe.
    // The middleware only references the Ratelimit class (via @upstash/ratelimit)
    // which handles this internally, but the top-level Redis import should
    // resolve to the edge/cloudflare export when bundled for the edge runtime.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        fs: false,
      };
    }

    return config;
  },
  // NOTE: Security headers (X-Frame-Options, HSTS, CSP, etc.) are set exclusively
  // in src/middleware.ts using a nonce-based CSP per request. Defining them here
  // in addition would cause every response to carry doubled headers.
  // Only static asset Cache-Control headers are set here because middleware does
  // not run on /_next/static/* paths.
  async headers() {
    return [
      // ── Cache static assets aggressively ────────────────────────────────
      {
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/(favicon\\.ico|favicon\\.png|apple-touch-icon\\.png|icon-512\\.png|og-image\\.png|manifest\\.json)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/:key([0-9a-f]{32})/:filename",
        destination: "/api/indexnow-key",
      },
    ];
  },
  async redirects() {
    return [
      // www → apex: Railway only provisions SSL for the apex domain.
      // Any www.optiaiseo.online request must be redirected server-side
      // to avoid ERR_CERT_COMMON_NAME_INVALID in browsers.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.optiaiseo.online" }],
        destination: "https://optiaiseo.online/:path*",
        permanent: true,
      },
      // /register was never a real page — all referral share links pointed here.
      // Redirect permanently to /signup; Next.js preserves the ?ref= query string.
      {
        source: '/register',
        destination: '/signup',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'optiaiseo-production.up.railway.app',
          },
        ],
        destination: 'https://optiaiseo.online/:path*',
        permanent: true,
      },

      // ── AEO guide consolidation — 301 redirects ─────────────────────────
      // 21 consolidated slugs → their canonical pages.
      // See: aeo_url_classification.md for the full decision matrix.
      { source: '/aeo-guide/aeo-beginners-guide',           destination: '/aeo-guide/what-is-answer-engine-optimization', permanent: true },
      { source: '/aeo-guide/indirect-aeo-benefits',         destination: '/aeo-guide/what-is-answer-engine-optimization', permanent: true },
      { source: '/aeo-guide/generative-ai-seo-2026',        destination: '/aeo-guide/what-is-generative-engine-optimization', permanent: true },
      { source: '/aeo-guide/how-ai-search-engines-work',    destination: '/aeo-guide/what-is-ai-search-engine', permanent: true },
      { source: '/aeo-guide/rank-in-google-sge',            destination: '/aeo-guide/how-to-appear-in-google-ai-overviews', permanent: true },
      { source: '/aeo-guide/how-to-get-cited-in-chatgpt',   destination: '/aeo-guide/how-to-rank-in-chatgpt-search', permanent: true },
      { source: '/aeo-guide/chatgpt-seo-strategy',          destination: '/aeo-guide/how-to-rank-in-chatgpt-search', permanent: true },
      { source: '/aeo-guide/perplexity-seo-strategy',       destination: '/aeo-guide/how-to-rank-in-perplexity-ai', permanent: true },
      { source: '/aeo-guide/optimize-for-llm-citations',    destination: '/aeo-guide/llm-seo-strategy', permanent: true },
      { source: '/aeo-guide/seo-vs-aeo-vs-geo',             destination: '/aeo-guide/answer-engine-optimization-vs-seo', permanent: true },
      { source: '/aeo-guide/traditional-seo-vs-ai-search',  destination: '/aeo-guide/answer-engine-optimization-vs-seo', permanent: true },
      { source: '/aeo-guide/ai-answers-vs-google-results',  destination: '/aeo-guide/featured-snippets-vs-ai-answers', permanent: true },
      { source: '/aeo-guide/optimize-content-for-ai-search', destination: '/aeo-guide/how-to-optimize-for-answer-engines', permanent: true },
      { source: '/aeo-guide/ai-search-traffic-strategy',    destination: '/aeo-guide/aeo-strategy-2026', permanent: true },
      { source: '/aeo-guide/answer-engine-ranking-factors',  destination: '/aeo-guide/ai-search-ranking-factors', permanent: true },
      { source: '/aeo-guide/schema-markup-aeo-guide',       destination: '/aeo-guide/structured-data-for-ai-search', permanent: true },
      { source: '/aeo-guide/faq-schema-ai-search',          destination: '/aeo-guide/structured-data-for-ai-search', permanent: true },
      { source: '/aeo-guide/best-ai-seo-tools-aeo',         destination: '/aeo-guide/answer-engine-optimization-tools', permanent: true },
      { source: '/aeo-guide/aeo-tools-free',                destination: '/aeo-guide/answer-engine-optimization-tools', permanent: true },
      { source: '/aeo-guide/aeo-tools-comparison',           destination: '/aeo-guide/answer-engine-optimization-tools', permanent: true },
      { source: '/aeo-guide/ai-share-of-voice',             destination: '/aeo-guide/ai-citation-tracking', permanent: true },
      // Removed page — no appropriate canonical; redirect to hub.
      { source: '/aeo-guide/aeo-india',                     destination: '/aeo-guide', permanent: false },
    ];
  },
};

// Wrap with Sentry's webpack plugin only when the package is present.
// This lets the Docker build succeed even if @sentry/nextjs is missing from the
// offline pnpm store — the runtime SDK (instrumentation.ts) still works fine.
let exportedConfig: unknown = nextConfig;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { withSentryConfig } = require("@sentry/nextjs") as typeof import("@sentry/nextjs");

  // Sentry's source-map upload holds every .map file in the Node heap
  // simultaneously. On Railway's Metal builder (~4 GB limit) this OOMs.
  // Disable it during Docker builds; source maps can be uploaded from CI instead.
  const disableSourceMaps = !!process.env.SENTRY_DISABLE_SOURCE_MAP_UPLOAD;

  exportedConfig = withSentryConfig(nextConfig, {
    org: "optiaiseo",
    project: "javascript-nextjs",
    silent: !process.env.CI,
    // Only widen source map upload when NOT in a memory-constrained Docker build.
    widenClientFileUpload: !disableSourceMaps,
    tunnelRoute: "/monitoring",
    // Disable the source map upload step entirely when the env var is set.
    sourcemaps: disableSourceMaps ? { disable: true } : undefined,
    webpack: {
      automaticVercelMonitors: true,
      treeshake: {
        removeDebugLogging: true,
      },
    },
  });
} catch {
  // @sentry/nextjs not available — export plain config without source-map upload.
  console.warn("[next.config] @sentry/nextjs not found; skipping Sentry webpack plugin.");
}

export default exportedConfig;
