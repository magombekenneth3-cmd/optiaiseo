"use client";

import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // Report to Sentry if the SDK is available at runtime.
    // The dynamic require keeps this module free of a hard @sentry/nextjs
    // static import so webpack never fails when the package is absent.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require("@sentry/nextjs") as typeof import("@sentry/nextjs");
      Sentry.captureException(error);
    } catch {
      // Sentry not available — log to console as fallback.
      console.error("[GlobalError]", error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
