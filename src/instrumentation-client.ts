// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

// Sentry is initialised dynamically so that a missing @sentry/nextjs package
// never breaks the webpack compilation or the client bundle.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require("@sentry/nextjs") as typeof import("@sentry/nextjs");

  Sentry.init({
    dsn: "https://326f0baf46b218070968e5ae53a04b28@o4511315040075776.ingest.us.sentry.io/4511315040272384",

    // Add optional integrations for additional features
    integrations: [Sentry.replayIntegration()],

    // Define how likely traces are sampled. Adjust this value in production,
    // or use tracesSampler for greater control.
    tracesSampleRate: 1,

    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Define how likely Replay events are sampled.
    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production.
    replaysSessionSampleRate: 0.1,

    // Define how likely Replay events are sampled when an error occurs.
    replaysOnErrorSampleRate: 1.0,

    // Enable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: true,
  });
} catch {
  // @sentry/nextjs not available — monitoring is disabled for this session.
  console.warn("[instrumentation-client] @sentry/nextjs not found; Sentry disabled.");
}

// Next.js calls this hook on every client-side router transition.
// Export a no-op when Sentry is absent so the module shape stays valid.
export const onRouterTransitionStart: ((href: string, navigationType: string) => void) | undefined = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/nextjs") as typeof import("@sentry/nextjs");
    // captureRouterTransitionStart signature: (href: string, navigationType: string) => void
    return Sentry.captureRouterTransitionStart as (href: string, navigationType: string) => void;
  } catch {
    return undefined;
  }
})();
