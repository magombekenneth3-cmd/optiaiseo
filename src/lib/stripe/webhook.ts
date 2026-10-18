import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import type Stripe from "stripe"
import { redis } from "@/lib/redis"
import { ALERT_EMAIL } from "@/lib/constants/auth"
import { bumpSessionVersion } from "@/lib/session-version"
import { grantCreditPackOnce } from "@/lib/stripe/credit-pack"
// The client is a lazy Proxy: nothing is constructed (and no key is read) until first use.
import { stripe } from "./client"

function extractPriceIdFromInvoice(invoice: Stripe.Invoice, fallbackPriceId: string): string {
    const lineItem = invoice.lines?.data?.[0]
    const priceId = (lineItem as Stripe.InvoiceLineItem & { price?: { id?: string } })?.price?.id

    if (priceId) return priceId

    logger.warn("[Stripe] Could not extract priceId from invoice line item", {
        invoiceId: invoice.id,
        lineItemKeys: lineItem ? Object.keys(lineItem) : null,
    })

    return fallbackPriceId
}

export function assertStripePriceIds(): void {
    const missing: string[] = []
    if (!process.env.STRIPE_STARTER_PRICE_ID) missing.push("STRIPE_STARTER_PRICE_ID")
    if (!process.env.STRIPE_PRO_PRICE_ID) missing.push("STRIPE_PRO_PRICE_ID")
    if (!process.env.STRIPE_AGENCY_PRICE_ID) missing.push("STRIPE_AGENCY_PRICE_ID")
    if (!process.env.STRIPE_STARTER_ANNUAL_PRICE_ID) missing.push("STRIPE_STARTER_ANNUAL_PRICE_ID")
    if (!process.env.STRIPE_PRO_ANNUAL_PRICE_ID) missing.push("STRIPE_PRO_ANNUAL_PRICE_ID")
    if (!process.env.STRIPE_AGENCY_ANNUAL_PRICE_ID) missing.push("STRIPE_AGENCY_ANNUAL_PRICE_ID")

    if (missing.length > 0) {
        logger.warn("[Stripe] Missing price ID env vars — paid-plan webhooks will not work correctly", {
            missing,
        })
    }
}

function getTierFromPriceId(priceId: string | null | undefined): string {
    if (!priceId) return "FREE"
    if (priceId === process.env.STRIPE_AGENCY_PRICE_ID)         return "AGENCY"
    if (priceId === process.env.STRIPE_PRO_PRICE_ID)            return "PRO"
    if (priceId === process.env.STRIPE_STARTER_PRICE_ID)        return "STARTER"
    if (priceId === process.env.STRIPE_AGENCY_ANNUAL_PRICE_ID)  return "AGENCY"
    if (priceId === process.env.STRIPE_PRO_ANNUAL_PRICE_ID)     return "PRO"
    if (priceId === process.env.STRIPE_STARTER_ANNUAL_PRICE_ID) return "STARTER"
    return "__UNKNOWN__"
}

async function resolveUserId(
    metadataUserId: string | undefined,
    stripeCustomerId: string | null
): Promise<string | null> {
    if (metadataUserId) return metadataUserId
    if (!stripeCustomerId) return null

    const sub = await prisma.subscription.findUnique({
        where: { stripeCustomerId },
        select: { userId: true },
    })

    return sub?.userId ?? null
}

async function assertKnownTier(tier: string, subscriptionId: string, userId: string): Promise<boolean> {
    if (tier !== "__UNKNOWN__") return true

    logger.error("[Stripe] Unrecognised price ID — user access NOT changed. Manual intervention required.", {
        subscriptionId,
        userId,
    })

    // Fire alert email to admin — once per hour per subscriptionId to avoid storms
    try {
        const alertKey = `stripe-unknown-price-alert:${subscriptionId}`
        // redis.set with nx:true returns "OK" on the *first* write, null if
        // the key already existed. We only want to send once per hour.
        const isFirstAlert = await redis.set(alertKey, "1", { ex: 3600, nx: true })
        if (isFirstAlert && process.env.RESEND_API_KEY && process.env.RESEND_FROM_DOMAIN && ALERT_EMAIL) {
            const { Resend } = await import("resend")
            const resend = new Resend(process.env.RESEND_API_KEY)
            void resend.emails.send({
                from: `OptiAISEO Alerts <noreply@${process.env.RESEND_FROM_DOMAIN}>`,
                to: ALERT_EMAIL,
                subject: "⚠️ Stripe: Unrecognised price ID — manual action required",
                html: `
                    <p><strong>An unrecognised Stripe price ID was received.</strong></p>
                    <p>User access has NOT been changed. This requires manual intervention.</p>
                    <ul>
                        <li><strong>Subscription ID:</strong> ${subscriptionId}</li>
                        <li><strong>User ID:</strong> ${userId}</li>
                        <li><strong>Time:</strong> ${new Date().toISOString()}</li>
                    </ul>
                    <p>Check Railway → Variables → <code>STRIPE_PRO_PRICE_ID</code>, <code>STRIPE_STARTER_PRICE_ID</code>, <code>STRIPE_AGENCY_PRICE_ID</code>.</p>
                `.trim(),
            }).catch((e: unknown) => logger.warn("[Stripe] Alert email failed to send", { error: (e as Error).message }))
        }
    } catch (e: unknown) {
        logger.warn("[Stripe] Could not send alert email", { error: (e as Error).message })
    }

    return false
}

function toPeriodEnd(timestamp: number | null | undefined): Date | null {
    return timestamp ? new Date(timestamp * 1000) : null
}



export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    // One-time payments (credit packs) have no subscription. Handle them before
    // the subscription requirement below, otherwise the paid session is
    // acknowledged without delivering credits.
    if (session.mode === "payment") {
        await handleCreditPackCheckout(session)
        return
    }

    const userId = await resolveUserId(session.metadata?.userId, session.customer as string | null)
    if (!userId) {
        logger.error("[Webhook] checkout.session.completed: could not resolve userId", { sessionId: session.id })
        // Required invariant: throw so the event is RETRY_PENDING, not PROCESSED.
        throw new Error(`checkout.session.completed ${session.id}: could not resolve userId`)
    }

    // For a subscription-mode session, a missing subscription is not success.
    if (typeof session.subscription !== "string" || !session.subscription) {
        throw new Error(`Checkout Session ${session.id} has no subscription`)
    }
    const subscriptionId = session.subscription

    const stripeSub = await stripe.subscriptions.retrieve(subscriptionId)
    const item = stripeSub.items.data[0]
    const priceId = item?.price.id ?? null
    const tier = getTierFromPriceId(priceId)

    if (!await assertKnownTier(tier, subscriptionId, userId)) return

    const subData = {
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscriptionId,
        stripePriceId: priceId,
        status: stripeSub.status,
        currentPeriodEnd: toPeriodEnd(item?.current_period_end),
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    }

    await prisma.subscription.upsert({
        where: { userId },
        create: { userId, ...subData },
        update: subData,
    })

    await prisma.user.update({
        where: { id: userId },
        data: { subscriptionTier: tier, trialEndsAt: null, creditsLockedAt: null },
    })

    await bumpSessionVersion(userId)

    logger.debug("[Webhook] User upgraded", { userId, tier })
}

async function handleCreditPackCheckout(session: Stripe.Checkout.Session): Promise<void> {
    // A delayed payment is not eligible for a grant yet. Asynchronous payment
    // methods are fulfilled by checkout.session.async_payment_succeeded, which
    // is routed back through handleCheckoutCompleted with payment_status "paid".
    if (session.payment_status !== "paid") {
        logger.info("[Stripe] Credit-pack session is not paid yet", {
            sessionId: session.id,
            paymentStatus: session.payment_status,
        })
        return
    }

    // Metadata is set server-side at session creation; fall back to the
    // customer → subscription lookup for customers that already exist.
    const userId = await resolveUserId(session.metadata?.userId, session.customer as string | null)
    const configuredPriceId = process.env.STRIPE_CREDIT_PACK_PRICE_ID
    if (!userId || !configuredPriceId) {
        // Throw (not return) so the event is marked RETRY_PENDING and stays visible.
        throw new Error(
            `Credit-pack session ${session.id} is missing user metadata or configured price`,
        )
    }

    if (session.metadata?.purchaseType && session.metadata.purchaseType !== "credit_pack") {
        throw new Error(
            `Unexpected purchaseType "${session.metadata.purchaseType}" on payment session ${session.id}`,
        )
    }

    // Verify the actual purchased line item rather than trusting browser input or
    // the new metadata label (sessions created before this deploy lack it).
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 })
    const onlyItem = lineItems.data.length === 1 ? lineItems.data[0] : undefined
    // Preserve the union handling: price may be an ID string or an expanded object.
    const rawPrice = onlyItem?.price as Stripe.Price | string | null | undefined
    const actualPriceId = typeof rawPrice === "string" ? rawPrice : rawPrice?.id

    if (actualPriceId !== configuredPriceId || onlyItem?.quantity !== 1) {
        throw new Error(`Unexpected line item on credit-pack session ${session.id}`)
    }

    // Optional but recommended: retrieve the configured fixed price and compare
    // amount/currency if the product does not use taxes, discounts, or adjustable quantities.
    const { CREDIT_PACK } = await import("@/lib/stripe/plans")
    const result = await grantCreditPackOnce(userId, session.id, CREDIT_PACK.credits)

    if (result.granted) {
        // Same as the legacy invoice path: refresh sessions so the new balance /
        // unlocked state is picked up immediately.
        await bumpSessionVersion(userId)
    }

    logger.info("[Stripe] Credit-pack checkout handled", {
        sessionId: session.id,
        userId,
        granted: result.granted,
        balance: result.balance,
    })
}

export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const userId = await resolveUserId(
        subscription.metadata?.userId,
        subscription.customer as string | null
    )
    if (!userId) {
        logger.error("[Webhook] subscription.updated: could not resolve userId", {
            subscriptionId: subscription.id,
        })
        // Required invariant (may also be an ordering race with checkout.session.completed):
        // throw so Stripe retries instead of the event being marked PROCESSED.
        throw new Error(`customer.subscription.updated ${subscription.id}: could not resolve userId`)
    }

    const item = subscription.items.data[0]
    const priceId = item?.price.id ?? null
    const tier = getTierFromPriceId(priceId)

    if (!await assertKnownTier(tier, subscription.id, userId)) return

    await prisma.subscription.upsert({
        where: { stripeSubscriptionId: subscription.id },
        create: {
            userId,
            stripeCustomerId: subscription.customer as string,
            stripeSubscriptionId: subscription.id,
            stripePriceId: priceId,
            status: subscription.status,
            currentPeriodEnd: toPeriodEnd(item?.current_period_end),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            cancelledAt: null,
        },
        update: {
            status: subscription.status,
            stripePriceId: priceId,
            currentPeriodEnd: toPeriodEnd(item?.current_period_end),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            cancelledAt: null,
        },
    })

    await prisma.user.update({
        where: { id: userId },
        data: { subscriptionTier: tier, trialEndsAt: null, creditsLockedAt: null },
    })

    await bumpSessionVersion(userId)

    logger.debug("[Webhook] Subscription updated", { userId, tier })
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const userId = await resolveUserId(
        subscription.metadata?.userId,
        subscription.customer as string | null
    )
    if (!userId) {
        logger.error("[Webhook] subscription.deleted: could not resolve userId", {
            subscriptionId: subscription.id,
        })
        // Required invariant: a cancellation we cannot attribute must stay visible/retryable.
        throw new Error(`customer.subscription.deleted ${subscription.id}: could not resolve userId`)
    }

    const now = new Date()

    try {
        await prisma.subscription.update({
            where: { stripeSubscriptionId: subscription.id },
            data: { status: "canceled", cancelledAt: now },
        })
    } catch (err: unknown) {
        if ((err as { code?: string })?.code !== "P2025") throw err
        logger.warn("[Webhook] subscription.deleted: no DB record found — skipping row update", {
            subscriptionId: subscription.id,
        })
    }

    // Grace period: keep tier for 2 days so credits remain usable.
    // Set a Redis key that the daily cron checks to finalise downgrade.
    const graceKey = `sub-grace:${userId}`
    const graceExpiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
    await redis.set(graceKey, JSON.stringify({
        userId,
        cancelledAt: now.toISOString(),
        graceExpiresAt: graceExpiresAt.toISOString(),
    }), { ex: 3 * 24 * 60 * 60 }) // Redis TTL = 3 days (grace + buffer)

    await bumpSessionVersion(userId)

    logger.info("[Webhook] Subscription canceled — 2-day grace period started", {
        userId,
        graceExpiresAt: graceExpiresAt.toISOString(),
    })
}

export async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string

    await prisma.subscription.update({
        where: { stripeCustomerId: customerId },
        data: { status: "past_due" },
    }).catch((err: unknown) => {
        // P2025: no record for this customer — nothing to mark past_due
        if ((err as { code?: string })?.code !== "P2025") throw err
        logger.warn("[Webhook] payment_failed: no subscription for customer", { customerId })
    })

    const sub = await prisma.subscription.findFirst({
        where: { stripeCustomerId: customerId },
        select: { userId: true },
    })

    if (sub?.userId) {
        await bumpSessionVersion(sub.userId)
        logger.warn("[Webhook] Payment failed — marked past_due, session invalidated", {
            customerId,
            userId: sub.userId,
        })
    } else {
        logger.warn("[Webhook] Payment failed — no subscription user found for customer", {
            customerId,
        })
    }
}

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string
    // Intentional ignores (not retryable invariants): invoices without a customer, or
    // for customers with no local Subscription row (e.g. one-off invoices), carry no
    // subscription lifecycle to apply. Subscription upgrades are applied by
    // checkout.session.completed, so an early invoice.paid is safe to skip.
    if (!customerId) {
        logger.info("[Webhook] invoice.paid without customer — ignored", { invoiceId: invoice.id })
        return
    }

    const subscription = await prisma.subscription.findFirst({
        where: { stripeCustomerId: customerId },
        select: { userId: true, stripePriceId: true },
    })
    if (!subscription?.userId) {
        logger.info("[Webhook] invoice.paid for customer with no local subscription — ignored", {
            invoiceId: invoice.id,
            customerId,
        })
        return
    }

    const priceId = extractPriceIdFromInvoice(invoice, subscription.stripePriceId ?? "")

    if (priceId === process.env.STRIPE_CREDIT_PACK_PRICE_ID) {
        // Credit packs are fulfilled exclusively by their paid Checkout Session
        // (handleCheckoutCompleted → grantCreditPackOnce, idempotent by session ID).
        // Granting here as well would credit the same purchase twice, so this
        // branch only acknowledges the invoice and stops it falling through to
        // the subscription-tier logic below.
        // Before deleting this branch entirely, confirm no legacy production flow
        // relied on invoice.paid for credit-pack fulfillment.
        logger.info("[Webhook] invoice.paid for credit-pack price — fulfilled via Checkout Session, skipping grant", {
            invoiceId: invoice.id,
            userId: subscription.userId,
        })
        return
    }

    const tier = getTierFromPriceId(priceId)
    if (!await assertKnownTier(tier, invoice.id ?? "unknown", subscription.userId)) return

    await prisma.subscription.updateMany({
        where: { stripeCustomerId: customerId },
        data: { status: "active" },
    })

    await prisma.user.update({
        where: { id: subscription.userId },
        data: { subscriptionTier: tier },
    })

    logger.debug("[Webhook] Invoice paid — tier confirmed", {
        customerId,
        userId: subscription.userId,
        tier,
    })

    try {
        const payingUser = await prisma.user.findUnique({
            where: { id: subscription.userId },
            select: { referralId: true },
        })

        const invoiceId = invoice.id
        const amountPaid = invoice.amount_paid ?? 0

        if (!payingUser?.referralId || !invoiceId || amountPaid <= 0) return

        const referral = await prisma.referral.findUnique({
            where: { id: payingUser.referralId },
            select: { id: true, ownerId: true, owner: { select: { email: true, name: true } } },
        })
        if (!referral) return

        const commissionCents = Math.round(amountPaid * 0.3)
        const month = new Date().toISOString().slice(0, 7)

        // Only create a commission if one doesn't already exist for this invoice.
        // Using findUnique + create instead of upsert so we know whether a new row
        // was actually created — we only increment the conversion counter on new rows.
        const existingCommission = await prisma.commission.findUnique({
            where: { stripeInvoiceId: invoiceId },
            select: { id: true },
        })

        if (existingCommission) {
            logger.info("[Affiliate] Commission already exists for invoice — skipping", {
                invoiceId,
                commissionId: existingCommission.id,
            })
            return
        }

        const commission = await prisma.commission.create({
            data: {
                referralId: referral.id,
                referrerId: referral.ownerId,
                amountCents: commissionCents,
                month,
                stripeInvoiceId: invoiceId,
                status: "pending",
            },
        })

        // Only increment conversions when a NEW commission was created —
        // not on Stripe retries of the same invoice.
        await prisma.referral.update({
            where: { id: referral.id },
            data: { conversions: { increment: 1 } },
        })

        if (referral.owner?.email && process.env.RESEND_FROM_DOMAIN) {
            const { Resend } = await import("resend")
            const resend = new Resend(process.env.RESEND_API_KEY)
            const dollars = (commissionCents / 100).toFixed(2)

            await resend.emails
                .send({
                    from: `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`,
                    to: referral.owner.email,
                    subject: `You earned $${dollars} — new OptiAISEO commission`,
                    html: `
            <p>Hi ${referral.owner.name ?? "there"},</p>
            <p>Great news! One of your referred users just paid their OptiAISEO subscription.</p>
            <p><strong>Your 30% commission: $${dollars}</strong> (for ${month})</p>
            <p>We batch commission payouts monthly. View your earnings in your <a href="https://optiaiseo.online/dashboard/settings?tab=affiliate">Affiliate Dashboard</a>.</p>
          `.trim(),
                })
                .catch(() => { })
        }

        logger.info("[Affiliate] Commission created", {
            commissionId: commission.id,
            referrerId: referral.ownerId,
            amountDollars: (commissionCents / 100).toFixed(2),
        })
    } catch (e: unknown) {
        logger.warn("[Affiliate] Commission creation failed", {
            error: e instanceof Error ? e.message : String(e),
        })
    }
}