import { randomUUID } from "crypto";

/**
 * Generates a RFC-4122 v4 UUID to use as a correlation ID.
 *
 * Usage — in API routes that dispatch Inngest jobs:
 * ```ts
 * const correlationId = generateCorrelationId();
 * await inngest.send({ name: "audit.run", data: { siteId, userId, correlationId } });
 * logger.info("[Audit] Job dispatched", { correlationId, siteId, userId });
 * ```
 *
 * Usage — in Inngest function handlers:
 * ```ts
 * const { correlationId } = event.data;
 * logger.info("Starting audit", { correlationId });
 * // Now every log line from this job is traceable to the original request.
 * ```
 */
export function generateCorrelationId(): string {
  return randomUUID();
}
