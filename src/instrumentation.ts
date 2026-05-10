/**
 * Next.js 15 instrumentation hook — called once at server startup.
 *
 * Sentry.init is placed here (not in sentry.server.config.ts / sentry.edge.config.ts)
 * as required by @sentry/nextjs v8+. The old config files are left in place
 * but are no longer the primary init path.
 *
 * ref: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * ref: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
 */

const SENTRY_DSN = "https://326f0baf46b218070968e5ae53a04b28@o4511315040075776.ingest.us.sentry.io/4511315040272384";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.init({
        dsn: SENTRY_DSN,
        tracesSampleRate: 1,
        enableLogs: true,
        sendDefaultPii: true,
      });
    } catch {
      console.warn("[instrumentation] @sentry/nextjs not found — Sentry disabled (nodejs).");
    }

    // OTEL telemetry (unchanged from before)
    try {
      const { initTelemetry } = await import("@/lib/telemetry");
      await initTelemetry();
    } catch {
      console.warn("[instrumentation] Failed to initialise OTEL telemetry.");
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.init({
        dsn: SENTRY_DSN,
        tracesSampleRate: 1,
        enableLogs: true,
        sendDefaultPii: true,
      });
    } catch {
      console.warn("[instrumentation] @sentry/nextjs not found — Sentry disabled (edge).");
    }
  }
}

/**
 * onRequestError — captures errors thrown in Server Components and RSC.
 * Required by @sentry/nextjs v8 for full RSC error coverage.
 * ref: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#errors-from-nested-react-server-components
 */
export const onRequestError: (
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string }
) => void | Promise<void> = async (err, request, context) => {
  try {
    const Sentry = await import("@sentry/nextjs");
    await Sentry.captureRequestError(err, request, context);
  } catch {
    // Sentry not available — silently skip
  }
};
