export const dynamic = "force-dynamic";
// =============================================================================
// STRIPE WEBHOOK HANDLER
// POST /api/webhooks/stripe
// =============================================================================

import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe/client"
import type Stripe from "stripe"
import { rateLimit, getClientIp } from "@/lib/rate-limit/check"
import { logger } from "@/lib/logger"
import { recordAndClaimStripeEvent, processStripeEvent } from "@/lib/stripe/webhook-events"

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

    // Deduplicate + claim — INSERT first; on P2002 atomically claim the existing row
    // only if it is RETRY_PENDING or its previous claim is stale (crashed worker).
    const claim = await recordAndClaimStripeEvent(event)

    if (claim === "ALREADY_PROCESSED") {
        // Already processed successfully — true dedup
        logger.info(`[Webhook] Duplicate event ${event.id} — skipping`)
        return NextResponse.json({ received: true })
    }

    if (claim === "IN_PROGRESS") {
        // A concurrent or recently claimed event is not a completed event.
        // Return non-2xx so Stripe retries; the reconciliation job also recovers
        // RECEIVED rows whose original invocation disappeared.
        logger.warn(`[Webhook] Event ${event.id} is claimed by another invocation — asking Stripe to retry`)
        return NextResponse.json({ error: "Webhook event is being processed; retry" }, { status: 500 })
    }

    // Process sequentially so the serverless function doesn't terminate prematurely.
    // If processing fails, the claim is released (RETRY_PENDING) and we return 500
    // so Stripe retries delivery.
    const processed = await processStripeEvent(event)
    if (!processed) {
        return NextResponse.json({ error: "Processing failed" }, { status: 500 })
    }

    return NextResponse.json({ received: true })
}
