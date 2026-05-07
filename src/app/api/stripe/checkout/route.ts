export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { createCheckoutSession } from "@/lib/stripe/client";
import { executeIdempotently } from "@/lib/stripe/idempotency";
import { getPlan } from "@/lib/stripe/plans";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit/check";

// All purchasable tiers — FREE is never purchased via checkout
const ALLOWED_TIERS = ["STARTER", "PRO", "AGENCY"] as const;
type AllowedTier = typeof ALLOWED_TIERS[number];


export async function POST(req: NextRequest) {
    try {
        // FIX #2: fail hard if NEXTAUTH_URL missing — silent localhost fallback breaks prod
        if (!process.env.NEXTAUTH_URL) {
            throw new Error("NEXTAUTH_URL is not configured");
        }
        const baseUrl = process.env.NEXTAUTH_URL;

        const user = await getAuthUser(req);
        if (!user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // FIX #10: rate limit — Stripe session creation is expensive
        const limited = await rateLimit("stripeCheckout", user!.id ?? user!.email);
        if (limited) {
            const body = await limited.json();
            return NextResponse.json({ error: body.error ?? "Too many requests." }, { status: 429 });
        }

        // FIX #1: require idempotency key — auto-generating defeats the purpose
        const idempotencyKey = req.headers.get("idempotency-key");
        if (!idempotencyKey) {
            return NextResponse.json({ error: "Missing Idempotency-Key header" }, { status: 400 });
        }

        // FIX #9: guard against malformed body
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { tier, mode, priceId: bodyPriceId, billing } = body as {
            tier?: string;
            mode?: string;
            priceId?: string;
            billing?: string;  // "monthly" | "annual"
        };

        const isAnnual = billing === "annual";

        // ── Credit pack — one-time payment, separate from subscription flow ──
        if (mode === "payment" && bodyPriceId === "credit_pack") {
            const creditPackPriceId = process.env.STRIPE_CREDIT_PACK_PRICE_ID;
            if (!creditPackPriceId) {
                return NextResponse.json({ error: "Credit packs are not configured" }, { status: 503 });
            }

            // Generate a server-side idempotency key for the credit pack purchase
            const user2 = await prisma.user.findUnique({
                where: { email: user!.email },
                select: { id: true },
            });
            if (!user2) return NextResponse.json({ error: "User not found" }, { status: 404 });

            const result = await executeIdempotently({
                idempotencyKey,
                userId: user2.id,
                requestPath: "/api/stripe/checkout/credit_pack",
                requestBody: { priceId: creditPackPriceId, userId: user2.id },
                handler: async () => {
                    const session = await createCheckoutSession({
                        userId: user2.id,
                        userEmail: user!.email!,
                        priceId: creditPackPriceId,
                        idempotencyKey,
                        mode: "payment",
                        successUrl: `${baseUrl}/dashboard/billing?success=true`,
                        cancelUrl: `${baseUrl}/dashboard/billing?canceled=true`,
                    });
                    if (!session.url) throw new Error("Stripe returned no checkout URL");
                    return { status: 200, body: { url: session.url } };
                },
            });
            return NextResponse.json(result.body, { status: result.status });
        }

        // ── Subscription tier upgrade / downgrade ─────────────────────────────
        if (!tier || !(ALLOWED_TIERS as readonly string[]).includes(tier)) {
            return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
        }
        const validTier = tier as AllowedTier;

        const plan = getPlan(validTier) as typeof getPlan extends (...a: any[]) => infer R ? R : never & {
            annualPriceId?: string | null;
        };

        // Pick annual price when requested and configured; fall back to monthly silently.
        const resolvedPriceId = isAnnual
            ? ((plan as Record<string, unknown>).annualPriceId as string | null | undefined) ?? plan.priceId
            : plan.priceId;

        if (!resolvedPriceId) {
            return NextResponse.json({ error: "No price configured for this tier" }, { status: 400 });
        }

        const dbUser = await prisma.user.findUnique({
            where: { email: user!.email },
            select: { id: true, subscriptionTier: true },
        });
        if (!dbUser) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        if (dbUser.subscriptionTier === validTier) {
            return NextResponse.json({ error: "Already on this plan" }, { status: 400 });
        }

        const result = await executeIdempotently({
            idempotencyKey,
            userId: user!.id,
            requestPath: "/api/stripe/checkout",
            requestBody: { tier: validTier, billing: billing ?? "monthly", userId: user!.id },
            handler: async () => {
                const checkoutSession = await createCheckoutSession({
                    userId: user!.id,
                    userEmail: user!.email!,
                    priceId: resolvedPriceId!,
                    idempotencyKey,
                    successUrl: `${baseUrl}/dashboard/billing?success=true`,
                    cancelUrl: `${baseUrl}/dashboard/billing?canceled=true`,
                });

                // FIX edge case: Stripe returned session without a URL
                if (!checkoutSession.url) {
                    throw new Error("Stripe returned no checkout URL");
                }

                return {
                    status: 200,
                    body: { url: checkoutSession.url },
                };
            },
        });

        return NextResponse.json(result.body, { status: result.status });
    } catch (err: unknown) {
        // FIX #8: include userId, tier, idempotencyKey in error log for observability
        const errMsg = (err as Error)?.message || String(err);
        logger.error("[Checkout] Error", {
            error: errMsg,
            userId: (err as { userId?: string })?.userId,
        });

        if (errMsg.includes("already being processed")) {
            return NextResponse.json(
                { error: "Request already in progress. Retry in a few seconds." },
                { status: 202 },
            );
        }
        if (errMsg.includes("different parameters")) {
            return NextResponse.json({ error: errMsg }, { status: 409 });
        }
        if (errMsg.includes("NEXTAUTH_URL is not configured")) {
            return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
        }

        return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }
}
