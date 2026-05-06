// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

// Wrapped in try/catch so the server starts cleanly even if @sentry/nextjs
// is not present in the deployment (e.g. missing from the pnpm offline store).
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require("@sentry/nextjs") as typeof import("@sentry/nextjs");

  Sentry.init({
    dsn: "https://326f0baf46b218070968e5ae53a04b28@o4511315040075776.ingest.us.sentry.io/4511315040272384",

    // Define how likely traces are sampled. Adjust this value in production,
    // or use tracesSampler for greater control.
    tracesSampleRate: 1,

    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Enable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: true,
  });
} catch {
  console.warn("[sentry.server.config] @sentry/nextjs not found; Sentry disabled.");
}
