import Stripe from "stripe"

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
    if (_stripe) return _stripe

    const key = process.env.STRIPE_SECRET_KEY
    if (!key) {
        throw new Error("STRIPE_SECRET_KEY is not set")
    }

    _stripe = new Stripe(key, {
        // Pin to the API version shipped with stripe@20.x. Bumping this should
        // be a deliberate, tested change — never let it drift with the dashboard.
        apiVersion: "2026-02-25.clover",
        typescript: true,
        appInfo: {
            name: "SEO Tool SAAS",
            version: "1.0.0",
        },
    })

    return _stripe
}

export const stripe = new Proxy({} as Stripe, {
    get(_target, prop) {
        return (getStripe() as unknown as Record<string | symbol, unknown>)[prop as string | symbol]
    },
})

export async function createCheckoutSession(opts: {
    userId: string
    userEmail: string
    priceId: string
    idempotencyKey: string
    successUrl: string
    cancelUrl: string
    mode?: "subscription" | "payment"
}): Promise<Stripe.Checkout.Session> {
    const { prisma } = await import("@/lib/prisma")

    const subscription = await prisma.subscription.findUnique({
        where: { userId: opts.userId },
        select: { stripeCustomerId: true },
    })

    const mode = opts.mode ?? "subscription"

    const params: Stripe.Checkout.SessionCreateParams = {
        mode,
        payment_method_types: ["card"],
        line_items: [{ price: opts.priceId, quantity: 1 }],
        success_url: opts.successUrl,
        cancel_url: opts.cancelUrl,
        metadata: { userId: opts.userId },
        ...(mode === "subscription"
            ? { subscription_data: { metadata: { userId: opts.userId } } }
            : {}),
        ...(subscription?.stripeCustomerId
            ? { customer: subscription.stripeCustomerId }
            : { customer_email: opts.userEmail }),
    }

    return getStripe().checkout.sessions.create(params, {
        idempotencyKey: opts.idempotencyKey,
    })
}

export async function createPortalSession(opts: {
    stripeCustomerId: string
    returnUrl: string
}): Promise<Stripe.BillingPortal.Session> {
    return getStripe().billingPortal.sessions.create({
        customer: opts.stripeCustomerId,
        return_url: opts.returnUrl,
    })
}