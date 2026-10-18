/**
 * Stripe webhook event lifecycle: durable dedup, atomic claim, processing, and
 * crash recovery.
 *
 * Status model (WebhookEvent.status):
 *   RECEIVED      — claimed by a worker (claimedAt set) and being processed.
 *   PROCESSED     — handler completed (or event type intentionally ignored).
 *   RETRY_PENDING — handler threw; claim released so a later delivery/reconcile retries.
 *
 * A RECEIVED row whose claim is older than STALE_CLAIM_MS is treated as abandoned
 * (process crashed between insert and status update) and can be re-claimed.
 * Only one worker can win a claim: claiming is a conditional updateMany.
 *
 * Retrying is only safe because the side effects are idempotent (credit-pack
 * grant keyed by Checkout Session, commission keyed by invoice, upserts for
 * subscription state). Any new money/credit side effect must be idempotent too.
 */
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
    handleCheckoutCompleted,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
    handlePaymentFailed,
    handleInvoicePaid,
} from "@/lib/stripe/webhook";

const PROVIDER = "stripe";

/**
 * Must be longer than the longest valid webhook processing time, otherwise a slow
 * but healthy worker could have its claim taken over.
 */
export const STALE_CLAIM_MS = 5 * 60 * 1000;
/** After this many attempts the reconciler stops replaying and only alerts. */
export const MAX_RECONCILE_ATTEMPTS = 10;
const MAX_ERROR_LENGTH = 1000;

export type ClaimResult = "CLAIMED" | "ALREADY_PROCESSED" | "IN_PROGRESS";

function eventKey(providerEventId: string) {
    return { provider_providerEventId: { provider: PROVIDER, providerEventId } };
}

function truncateError(err: unknown): string {
    const message = (err as Error)?.message || String(err);
    return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

/**
 * Insert a newly delivered (already signature-verified) event and claim it.
 * If the event already exists (P2002), attempt to claim the existing row instead.
 */
export async function recordAndClaimStripeEvent(event: Stripe.Event, now = new Date()): Promise<ClaimResult> {
    try {
        await prisma.webhookEvent.create({
            data: {
                provider: PROVIDER,
                providerEventId: event.id,
                eventType: event.type,
                payload: event as unknown as object,
                status: "RECEIVED",
                claimedAt: now,
                attempts: 1,
            },
        });
        return "CLAIMED";
    } catch (e: unknown) {
        if ((e as { code?: string })?.code !== "P2002") throw e;
    }
    return claimExistingStripeEvent(event.id, now);
}

/**
 * Atomically claim an existing event row. Only RETRY_PENDING rows and RECEIVED
 * rows with a stale (or missing) claim are claimable; exactly one caller wins.
 */
export async function claimExistingStripeEvent(providerEventId: string, now = new Date()): Promise<ClaimResult> {
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);

    const claim = await prisma.webhookEvent.updateMany({
        where: {
            provider: PROVIDER,
            providerEventId,
            OR: [
                { status: "RETRY_PENDING" },
                { status: "RECEIVED", claimedAt: { lt: staleBefore } },
                // Rows created before the claim columns existed have claimedAt = NULL.
                { status: "RECEIVED", claimedAt: null, createdAt: { lt: staleBefore } },
            ],
        },
        data: {
            status: "RECEIVED",
            claimedAt: now,
            attempts: { increment: 1 },
            lastError: null,
        },
    });

    if (claim.count === 1) {
        logger.info(`[Webhook] Claimed existing event ${providerEventId} for (re)processing`);
        return "CLAIMED";
    }

    const existing = await prisma.webhookEvent.findUnique({
        where: eventKey(providerEventId),
        select: { status: true },
    });

    if (existing?.status === "PROCESSED") return "ALREADY_PROCESSED";

    // A concurrent or recently claimed event is not a completed event.
    return "IN_PROGRESS";
}

/**
 * Run the handler for a claimed event and record the outcome.
 * Returns true on success; false means the event is RETRY_PENDING.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<boolean> {
    try {
        switch (event.type) {
            case "checkout.session.completed":
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            case "checkout.session.async_payment_succeeded":
                // Delayed payment methods: same idempotent fulfillment path, now with payment_status "paid".
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            case "checkout.session.async_payment_failed": {
                // Never route a failed payment through the grant path.
                const failed = event.data.object as Stripe.Checkout.Session;
                logger.warn("[Webhook] Checkout async payment failed — no credits granted", {
                    sessionId: failed.id,
                    userId: failed.metadata?.userId,
                    mode: failed.mode,
                });
                break;
            }
            case "customer.subscription.updated":
                await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
                break;
            case "customer.subscription.deleted":
                await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                break;
            case "invoice.payment_failed":
                await handlePaymentFailed(event.data.object as Stripe.Invoice);
                break;
            case "invoice.paid":
                await handleInvoicePaid(event.data.object as Stripe.Invoice);
                break;
            default:
                // Unknown types have no side effect: safe to mark processed once logged.
                logger.info(`[Webhook] Unhandled event type: ${event.type}`);
        }

        await prisma.webhookEvent.update({
            where: eventKey(event.id),
            data: { status: "PROCESSED", processedAt: new Date(), claimedAt: null, lastError: null },
        });

        return true;
    } catch (err: unknown) {
        logger.error(`[Webhook] Failed to process event ${event.id}`, { error: truncateError(err) });

        // Release the claim so the next Stripe delivery (or the reconciler) can retry.
        await prisma.webhookEvent
            .update({
                where: eventKey(event.id),
                data: { status: "RETRY_PENDING", claimedAt: null, lastError: truncateError(err) },
            })
            .catch((e) =>
                logger.error(`[Webhook] Failed to update event status ${event.id}`, { error: truncateError(e) }),
            );

        return false;
    }
}

export interface ReconcileSummary {
    scanned: number;
    replayed: number;
    succeeded: number;
    failed: number;
    skippedInProgress: number;
    exhausted: number;
}

/**
 * Recover events abandoned by a crashed invocation (stale RECEIVED) and failed
 * events Stripe may have stopped retrying (RETRY_PENDING, idle past the cutoff).
 * Replays from the persisted payload, which was stored only after signature
 * verification. Events past MAX_RECONCILE_ATTEMPTS are alerted, not replayed.
 */
export async function reconcileStaleStripeEvents(opts: { limit?: number; now?: Date } = {}): Promise<ReconcileSummary> {
    const now = opts.now ?? new Date();
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);

    const candidates = await prisma.webhookEvent.findMany({
        where: {
            provider: PROVIDER,
            OR: [
                { status: "RECEIVED", claimedAt: { lt: staleBefore } },
                { status: "RECEIVED", claimedAt: null, createdAt: { lt: staleBefore } },
                // Give Stripe's own retry a head start before the reconciler competes.
                { status: "RETRY_PENDING", updatedAt: { lt: staleBefore } },
            ],
        },
        select: { providerEventId: true, eventType: true, attempts: true, payload: true, lastError: true },
        orderBy: { createdAt: "asc" },
        take: opts.limit ?? 25,
    });

    const summary: ReconcileSummary = {
        scanned: candidates.length,
        replayed: 0,
        succeeded: 0,
        failed: 0,
        skippedInProgress: 0,
        exhausted: 0,
    };

    for (const candidate of candidates) {
        if (candidate.attempts >= MAX_RECONCILE_ATTEMPTS) {
            summary.exhausted++;
            logger.error("[Webhook] Stripe event exhausted retry attempts — manual replay required", {
                providerEventId: candidate.providerEventId,
                eventType: candidate.eventType,
                attempts: candidate.attempts,
                lastError: candidate.lastError,
            });
            continue;
        }

        const claim = await claimExistingStripeEvent(candidate.providerEventId, now);
        if (claim !== "CLAIMED") {
            summary.skippedInProgress++;
            continue;
        }

        summary.replayed++;
        const ok = await processStripeEvent(candidate.payload as unknown as Stripe.Event);
        if (ok) summary.succeeded++;
        else summary.failed++;
    }

    if (summary.scanned > 0) {
        if (summary.failed > 0 || summary.exhausted > 0) {
            logger.error("[Webhook] Stripe event reconciliation pass had failures", { ...summary });
        } else {
            logger.warn("[Webhook] Stripe event reconciliation pass recovered events", { ...summary });
        }
    }

    return summary;
}
