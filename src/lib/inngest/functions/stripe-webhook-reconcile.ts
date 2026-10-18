/**
 * Stripe webhook crash-recovery reconciler.
 *
 * Finds WebhookEvent rows abandoned by a crashed invocation (stale RECEIVED) or
 * left RETRY_PENDING after Stripe's own retries, atomically claims each one, and
 * replays it from the persisted (signature-verified) payload. Events past the
 * attempt cap are logged at error level for manual replay instead.
 *
 * Safe to retry only because webhook side effects are idempotent (see
 * src/lib/stripe/webhook-events.ts).
 */
import { inngest } from "../client";
import { logger } from "@/lib/logger";
import { reconcileStaleStripeEvents } from "@/lib/stripe/webhook-events";

export const stripeWebhookReconcileJob = inngest.createFunction(
    {
        id: "stripe-webhook-reconcile",
        name: "Stripe Webhook Reconciliation",
        retries: 1,
        concurrency: { limit: 1 }, // cron — must never run concurrently

        triggers: [{ cron: "*/10 * * * *" }],
    },
    // Every 10 minutes (stale-claim cutoff is 5 minutes)
    async ({ step }) => {
        const summary = await step.run("reconcile-stale-stripe-events", () =>
            reconcileStaleStripeEvents({ limit: 25 }),
        );
        logger.info("[Webhook] Reconciliation job complete", { ...summary });
        return summary;
    },
);
