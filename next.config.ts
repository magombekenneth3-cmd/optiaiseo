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
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'optiaiseo-production.up.railway.app',
          },
        ],
        destination: 'https://www.optiaiseo.online/:path*',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'optiaiseo.online',
          },
        ],
        destination: 'https://www.optiaiseo.online/:path*',
        permanent: true,
      },
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
