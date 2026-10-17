export const dynamic = "force-dynamic";
// =============================================================================
// STRIPE WEBHOOK HANDLER
// POST /api/webhooks/stripe
// =============================================================================

import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe/client"
import { prisma } from "@/lib/prisma"
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library"
import {
    handleCheckoutCompleted,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
    handlePaymentFailed,
    handleInvoicePaid,
} from "@/lib/stripe/webhook"
import type Stripe from "stripe"
import { rateLimit, getClientIp } from "@/lib/rate-limit/check"
import { logger } from "@/lib/logger"

export async function POST(req: NextRequest) {
    // Rate limit per IP — legitimate Stripe delivery comes from known IP ranges;
    // this blocks volume attacks before we do any crypto work.
    const ip = getClientIp(req)
    const limited = await rateLimit("webhook", `stripe-webhook:${ip}`)
    if (limited) return limited

    const sig = req.headers.get("stripe-signature")
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

    if (!sig || !webhookSecret) {
        return NextResponse.json({ error: "Missing signature" }, { status: 400 })
    }

    // MUST use raw buffer for signature verification
    const rawBody = await req.text()

    let event: Stripe.Event
    try {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
     
     
    } catch (err: unknown) {
        logger.error("[Webhook] Signature verification failed", { error: (err as Error)?.message || String(err) })
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
    }

    // Deduplicate — INSERT first, if P2002 we already processed this event
    try {
        await prisma.webhookEvent.create({
            data: {
                provider: "stripe",
                providerEventId: event.id,
                eventType: event.type,
                payload: event as unknown as object,
                status: "RECEIVED",
            },
         
        })
     
    } catch (e: unknown) {
        if (e instanceof PrismaClientKnownRequestError && e.code === "P2002") {
            // Check if this is a retry of a previously-failed event
            const existing = await prisma.webhookEvent.findUnique({
                where: {
                    provider_providerEventId: { provider: "stripe", providerEventId: event.id },
                },
                select: { status: true },
            })

            if (existing?.status === "RETRY_PENDING") {
                // Allow Stripe's retry: reset status so processWebhookEvent runs again
                await prisma.webhookEvent.update({
                    where: {
                        provider_providerEventId: { provider: "stripe", providerEventId: event.id },
                    },
                    data: { status: "RECEIVED" },
                })
                logger.info(`[Webhook] Retrying previously-failed event ${event.id}`)
                // Fall through to processWebhookEvent below
            } else {
                // Already processed successfully — true dedup
                logger.info(`[Webhook] Duplicate event ${event.id} — skipping`)
                return NextResponse.json({ received: true })
            }
        } else {
            throw e
        }
    }

    // Process sequentially so the serverless function doesn't terminate prematurely.
    // If processing fails, return 500 so Stripe retries delivery.
    // The deduplication guard above will prevent double-processing on retry:
    // the P2002 catch returns 200 immediately for already-seen event IDs.
    const processed = await processWebhookEvent(event)
    if (!processed) {
        return NextResponse.json({ error: "Processing failed" }, { status: 500 })
    }

    return NextResponse.json({ received: true })
}

async function processWebhookEvent(event: Stripe.Event): Promise<boolean> {
    try {
        switch (event.type) {
            case "checkout.session.completed":
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
                break
            case "checkout.session.async_payment_succeeded":
                // Delayed payment methods: same idempotent fulfillment path, now with payment_status "paid".
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
                break
            case "checkout.session.async_payment_failed": {
                // Never route a failed payment through the grant path.
                const failed = event.data.object as Stripe.Checkout.Session
                logger.warn("[Webhook] Checkout async payment failed — no credits granted", {
                    sessionId: failed.id,
                    userId: failed.metadata?.userId,
                    mode: failed.mode,
                })
                break
            }
            case "customer.subscription.updated":
                await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
                break
            case "customer.subscription.deleted":
                await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
                break
            case "invoice.payment_failed":
                await handlePaymentFailed(event.data.object as Stripe.Invoice)
                break
            case "invoice.paid":
                await handleInvoicePaid(event.data.object as Stripe.Invoice)
                break
            default:
                logger.info(`[Webhook] Unhandled event type: ${event.type}`)
        }

        await prisma.webhookEvent.update({
            where: {
                provider_providerEventId: { provider: "stripe", providerEventId: event.id },
            },
             
            data: { status: "PROCESSED", processedAt: new Date() },
        })

        return true
    } catch (err: unknown) {
        logger.error(`[Webhook] Failed to process event ${event.id}`, { error: (err as Error)?.message || String(err) })

        // Mark as RETRY_PENDING so the dedup guard allows Stripe's next delivery attempt.
        // The dedup INSERT will P2002, but we check the existing row's status and
        // allow re-processing if it's RETRY_PENDING (see retry logic below).
        await prisma.webhookEvent
            .update({
                where: {
                    provider_providerEventId: { provider: "stripe", providerEventId: event.id },
                },
                data: { status: "RETRY_PENDING" },
            })
            .catch((e) => logger.error(`[Webhook] Failed to update event status ${event.id}`, { error: (e as Error)?.message || String(e) }))

        return false
    }
}
