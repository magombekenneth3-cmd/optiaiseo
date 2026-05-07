import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import type Stripe from "stripe"
import { redis } from "@/lib/redis"
import { ALERT_EMAIL } from "@/lib/constants/auth"
import { bumpSessionVersion } from "@/lib/session-version"

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

    if (missing.length > 0) {
        logger.warn("[Stripe] Missing price ID env vars — paid-plan webhooks will not work correctly", {
            missing,
        })
    }
}

function getTierFromPriceId(priceId: string | null | undefined): string {
    if (!priceId) return "FREE"
    if (priceId === process.env.STRIPE_AGENCY_PRICE_ID) return "AGENCY"
    if (priceId === process.env.STRIPE_PRO_PRICE_ID) return "PRO"
    if (priceId === process.env.STRIPE_STARTER_PRICE_ID) return "STARTER"
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
    const userId = await resolveUserId(session.metadata?.userId, session.customer as string | null)
    if (!userId) {
        logger.error("[Webhook] checkout.session.completed: could not resolve userId")
        return
    }

    const subscriptionId = session.subscription as string
    if (!subscriptionId) return

    const { stripe } = await import("./client")
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
        data: { subscriptionTier: tier, trialEndsAt: null },
    })

    await bumpSessionVersion(userId)

    logger.debug("[Webhook] User upgraded", { userId, tier })
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
        return
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
        },
        update: {
            status: subscription.status,
            stripePriceId: priceId,
            currentPeriodEnd: toPeriodEnd(item?.current_period_end),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
    })

    await prisma.user.update({
        where: { id: userId },
        data: { subscriptionTier: tier, trialEndsAt: null },
    })

    await bumpSessionVersion(userId)

    logger.debug("[Webhook] Subscription updated", { userId, tier })
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const userId = await resolveUserId(
        subscription.metadata?.userId,
        subscription.customer as string | null
    )
    if (!userId) return

    try {
        await prisma.subscription.update({
            where: { stripeSubscriptionId: subscription.id },
            data: { status: "canceled" },
        })
    } catch (err: unknown) {
        if ((err as { code?: string })?.code !== "P2025") throw err
        logger.warn("[Webhook] subscription.deleted: no DB record found — skipping row update", {
            subscriptionId: subscription.id,
        })
    }

    await prisma.user.update({
        where: { id: userId },
        data: { subscriptionTier: "FREE" },
    })

    await bumpSessionVersion(userId)

    logger.debug("[Webhook] Subscription canceled — downgraded to FREE", { userId })
}

export async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string

    // Mark subscription past_due in a single write.
    await prisma.subscription.updateMany({
        where: { stripeCustomerId: customerId },
        data: { status: "past_due" },
    })

    // Resolve the owning user so we can downgrade their tier and invalidate
    // their session. guards.ts checks sub.status === "canceled" to gate access,
    // but "past_due" is not "canceled" — so without an explicit tier downgrade
    // here the user would retain paid-feature access despite a failed payment.
    const sub = await prisma.subscription.findFirst({
        where: { stripeCustomerId: customerId },
        select: { userId: true },
    })

    if (sub?.userId) {
        await prisma.user.update({
            where: { id: sub.userId },
            data: { subscriptionTier: "FREE" },
        })
        await bumpSessionVersion(sub.userId)
        logger.warn("[Webhook] Payment failed — downgraded to FREE and session invalidated", {
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
    if (!customerId) return

    const subscription = await prisma.subscription.findFirst({
        where: { stripeCustomerId: customerId },
        select: { userId: true, stripePriceId: true },
    })
    if (!subscription?.userId) return

    const priceId = extractPriceIdFromInvoice(invoice, subscription.stripePriceId ?? "")

    if (priceId === process.env.STRIPE_CREDIT_PACK_PRICE_ID) {
        const { addCreditPackCredits } = await import("@/lib/credits")
        await addCreditPackCredits(subscription.userId, 50)
        await bumpSessionVersion(subscription.userId)
        logger.debug("[Webhook] Credit pack purchased", { userId: subscription.userId })
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

        const commission = await prisma.commission.upsert({
            where: { stripeInvoiceId: invoiceId },
            create: {
                referralId: referral.id,
                referrerId: referral.ownerId,
                amountCents: commissionCents,
                month,
                stripeInvoiceId: invoiceId,
                status: "pending",
            },
            update: {},
        })

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