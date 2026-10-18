/**
 * Audit credit billing: charge once when a manual full-site audit is created,
 * refund once if that audit ends FAILED.
 *
 * Both sides are keyed by the audit ID in CreditLedger (unique [userId, referenceId]),
 * so Inngest retries, onFailure handlers, the stuck-audit sweep and concurrent
 * requests can all call these helpers safely: at most one charge and at most one
 * refund per audit. A refund is only issued when a charge row exists, so audits
 * that were never charged (cron/weekly audits, homepage-only, pre-deploy audits)
 * are never "refunded" into free credits.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { CREDIT_COSTS, ACTION_LABELS } from "./constants";

const AUDIT_ACTION = "full_site_audit" as const;

export function auditChargeReferenceId(auditId: string): string {
    return `audit:${auditId}:charge`;
}

export function auditRefundReferenceId(auditId: string): string {
    return `audit:${auditId}:refund`;
}

export type AuditChargeResult =
    | { charged: true; alreadyCharged: boolean; cost: number; remaining: number | null }
    | { charged: false; reason: "insufficient_credits" | "credits_locked"; cost: number; remaining: number };

function isUniqueViolation(error: unknown): boolean {
    return (error as { code?: string })?.code === "P2002";
}

/**
 * Atomically deducts the full-site-audit cost for `auditId`, at most once.
 * The balance decrement, the CreditLedger row and the CreditHistory row commit
 * together; a concurrent duplicate charge loses on the unique ledger key and
 * its decrement rolls back.
 */
export async function chargeAuditCreditsOnce(userId: string, auditId: string): Promise<AuditChargeResult> {
    if (!userId || !auditId) throw new Error("userId and auditId are required to charge an audit");

    const cost = CREDIT_COSTS[AUDIT_ACTION];
    const referenceId = auditChargeReferenceId(auditId);

    try {
        return await prisma.$transaction(async (tx): Promise<AuditChargeResult> => {
            const existing = await tx.creditLedger.findUnique({
                where: { userId_referenceId: { userId, referenceId } },
                select: { id: true },
            });
            if (existing) return { charged: true, alreadyCharged: true, cost, remaining: null };

            // Same conditional decrement as consumeCredits(): never goes negative,
            // never spends locked credits.
            const rows: { credits: number }[] = await tx.$queryRaw`
                UPDATE "User"
                SET credits = credits - ${cost}
                WHERE id = ${userId}
                AND credits >= ${cost}
                AND "creditsLockedAt" IS NULL
                RETURNING credits
            `;

            if (rows.length === 0) {
                const user = await tx.user.findUnique({
                    where: { id: userId },
                    select: { credits: true, creditsLockedAt: true },
                });
                return {
                    charged: false,
                    reason: user?.creditsLockedAt ? "credits_locked" : "insufficient_credits",
                    cost,
                    remaining: user?.credits ?? 0,
                };
            }

            const remaining = rows[0].credits;

            // Negative ledger amount = credits spent (positive = granted/refunded).
            await tx.creditLedger.create({
                data: {
                    userId,
                    amount: -cost,
                    type: "CHARGE",
                    referenceId,
                    reason: `${ACTION_LABELS[AUDIT_ACTION]} ${auditId}`,
                },
            });

            await tx.creditHistory.create({
                data: {
                    userId,
                    action: AUDIT_ACTION,
                    label: ACTION_LABELS[AUDIT_ACTION],
                    cost,
                    balanceAfter: remaining,
                    metadata: { auditId },
                },
            });

            logger.info("[AuditBilling] Charged audit credits", { userId, auditId, cost, remaining });
            return { charged: true, alreadyCharged: false, cost, remaining };
        });
    } catch (error) {
        if (isUniqueViolation(error)) {
            // A concurrent request charged this audit first; ours rolled back.
            logger.info("[AuditBilling] Audit charge lost race to concurrent charge", { userId, auditId });
            return { charged: true, alreadyCharged: true, cost, remaining: null };
        }
        logger.error("[AuditBilling] Audit charge failed", {
            userId,
            auditId,
            error: (error as Error)?.message || String(error),
        });
        throw error;
    }
}

export type AuditRefundResult =
    | { refunded: true; amount: number; balance: number }
    | { refunded: false; reason: "not_charged" | "already_refunded" | "not_failed" | "audit_not_found" };

/**
 * Refunds exactly what was charged for `auditId`, at most once, and only if a
 * charge exists. Throws on unexpected database errors so Inngest steps retry.
 */
export async function refundAuditCreditsOnce(
    userId: string,
    auditId: string,
    reason: string,
): Promise<AuditRefundResult> {
    if (!userId || !auditId) throw new Error("userId and auditId are required to refund an audit");

    const chargeRef = auditChargeReferenceId(auditId);
    const refundRef = auditRefundReferenceId(auditId);

    try {
        return await prisma.$transaction(async (tx): Promise<AuditRefundResult> => {
            const charge = await tx.creditLedger.findUnique({
                where: { userId_referenceId: { userId, referenceId: chargeRef } },
                select: { amount: true },
            });
            if (!charge || charge.amount >= 0) return { refunded: false, reason: "not_charged" };

            const already = await tx.creditLedger.findUnique({
                where: { userId_referenceId: { userId, referenceId: refundRef } },
                select: { id: true },
            });
            if (already) return { refunded: false, reason: "already_refunded" };

            const amount = -charge.amount;

            await tx.creditLedger.create({
                data: { userId, amount, type: "REFUND", referenceId: refundRef, reason },
            });

            const user = await tx.user.update({
                where: { id: userId },
                data: { credits: { increment: amount } },
                select: { credits: true },
            });

            await tx.creditHistory.create({
                data: {
                    userId,
                    action: AUDIT_ACTION,
                    label: `REFUND: ${ACTION_LABELS[AUDIT_ACTION]}`,
                    cost: -amount, // Negative cost = credits added (existing convention)
                    balanceAfter: user.credits,
                    metadata: { auditId, reason },
                },
            });

            logger.info("[AuditBilling] Refunded audit credits", { userId, auditId, amount, reason });
            return { refunded: true, amount, balance: user.credits };
        });
    } catch (error) {
        if (isUniqueViolation(error)) {
            logger.info("[AuditBilling] Audit refund lost race to concurrent refund", { userId, auditId });
            return { refunded: false, reason: "already_refunded" };
        }
        logger.error("[AuditBilling] Audit refund failed", {
            userId,
            auditId,
            error: (error as Error)?.message || String(error),
        });
        throw error;
    }
}

/**
 * Refunds a charged audit only if it is currently FAILED. Used by every path
 * that can finalize an audit as FAILED (job onFailure handlers, the all-pages-
 * failed finalizer, the stuck-audit sweep). Safe to call repeatedly.
 */
export async function refundAuditIfFailed(auditId: string, reason: string): Promise<AuditRefundResult> {
    const audit = await prisma.audit.findUnique({
        where: { id: auditId },
        select: { fixStatus: true, site: { select: { userId: true } } },
    });
    if (!audit?.site?.userId) return { refunded: false, reason: "audit_not_found" };
    if (audit.fixStatus !== "FAILED") return { refunded: false, reason: "not_failed" };
    return refundAuditCreditsOnce(audit.site.userId, auditId, reason);
}
