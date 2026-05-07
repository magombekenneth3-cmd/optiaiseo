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
            logger.info(`[Webhook] Duplicate event ${event.id} — skipping`)
            return NextResponse.json({ received: true })
        }
        throw e
    }

    // Process sequentially so the serverless function doesn't terminate prematurely
    await processWebhookEvent(event)

    return NextResponse.json({ received: true })
}

async function processWebhookEvent(event: Stripe.Event): Promise<void> {
    try {
        switch (event.type) {
            case "checkout.session.completed":
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
                break
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
     
    } catch (err: unknown) {
        logger.error(`[Webhook] Failed to process event ${event.id}`, { error: (err as Error)?.message || String(err) })
        await prisma.webhookEvent
            .update({
                where: {
                    provider_providerEventId: { provider: "stripe", providerEventId: event.id },
                },
                data: { status: "FAILED" },
            })
            .catch((e) => logger.error(`[Webhook] Failed to update event status ${event.id}`, { error: (e as Error)?.message || String(e) }))
    }
}
