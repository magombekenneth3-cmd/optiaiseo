/**
 * Idempotent Stripe credit-pack fulfillment.
 *
 * The Stripe Checkout Session ID is the unique external reference, so Stripe can
 * redeliver a webhook (or two deliveries can race) without incrementing credits
 * twice. The credit increment and both ledger writes commit in one transaction.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export function creditPackReferenceId(sessionId: string): string {
    return `stripe:checkout-session:${sessionId}`;
}

export async function grantCreditPackOnce(
    userId: string,
    sessionId: string,
    creditsToAdd: number,
): Promise<{ granted: boolean; balance?: number }> {
    if (!Number.isInteger(creditsToAdd) || creditsToAdd <= 0) {
        throw new Error("Invalid credit-pack amount");
    }
    // An empty sessionId would collapse every grant onto one shared reference,
    // silently skipping all but the first purchase.
    if (!userId || !sessionId) {
        throw new Error("userId and sessionId are required to grant a credit pack");
    }

    const referenceId = creditPackReferenceId(sessionId);

    try {
        return await prisma.$transaction(async (tx) => {
            const existing = await tx.creditLedger.findUnique({
                where: { userId_referenceId: { userId, referenceId } },
                select: { id: true },
            });

            if (existing) {
                logger.info("[Credits] Credit pack already granted (idempotent skip)", { userId, sessionId });
                return { granted: false };
            }

            // A positive ledger amount represents a credit grant.
            // The reference is unique per user and Stripe Checkout Session.
            await tx.creditLedger.create({
                data: {
                    userId,
                    amount: creditsToAdd,
                    type: "PURCHASE",
                    referenceId,
                    reason: `Stripe credit-pack Checkout Session ${sessionId}`,
                },
            });

            const user = await tx.user.update({
                where: { id: userId },
                data: {
                    credits: { increment: creditsToAdd },
                    // Keep this only if purchasing a pack is intentionally allowed
                    // to unlock credits after subscription expiry. Confirm the policy.
                    creditsLockedAt: null,
                },
                select: { credits: true },
            });

            // Keep the user-facing history and authoritative ledger consistent.
            await tx.creditHistory.create({
                data: {
                    userId,
                    action: "credit_pack_purchase",
                    label: "Credit Pack Purchase",
                    cost: -creditsToAdd, // Negative cost = credits added (existing convention)
                    balanceAfter: user.credits,
                    metadata: { stripeSessionId: sessionId },
                },
            });

            logger.info("[Credits] Credit pack granted", {
                userId,
                sessionId,
                creditsToAdd,
                balance: user.credits,
            });

            return { granted: true, balance: user.credits };
        });
    } catch (error) {
        // Two deliveries can race: the unique constraint permits only one grant.
        // The losing transaction has rolled back, so re-check outside it.
        if ((error as { code?: string })?.code === "P2002") {
            const existing = await prisma.creditLedger.findUnique({
                where: { userId_referenceId: { userId, referenceId } },
                select: { id: true },
            });
            if (existing) {
                logger.info("[Credits] Credit pack grant lost race to concurrent delivery", { userId, sessionId });
                return { granted: false };
            }
        }
        logger.error("[Credits] Credit pack grant failed", {
            userId,
            sessionId,
            error: (error as Error)?.message || String(error),
        });
        throw error;
    }
}
