/**
 * PR 1 — Stripe one-time credit-pack fulfillment.
 *
 * Uses an in-memory Prisma fake that stages writes per transaction and enforces
 * the CreditLedger @@unique([userId, referenceId]) constraint at commit time, so
 * duplicate and interleaved (concurrent) deliveries behave like Postgres would.
 * The real-database proof of the unique constraint lives in
 * tests/integration/stripe-credit-pack.db.test.ts (opt-in, needs Postgres).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

const h = vi.hoisted(() => {
    type LedgerRow = { id: string; userId: string; referenceId: string; amount: number; type: string; reason?: string | null };
    type HistoryRow = { userId: string; action: string; cost: number; balanceAfter: number; metadata?: unknown };
    type UserRow = { id: string; credits: number; creditsLockedAt: Date | null };

    const state = {
        users: new Map<string, UserRow>(),
        ledger: [] as LedgerRow[],
        history: [] as HistoryRow[],
        failHistoryWrite: false,
        seq: 0,
    };

    const tick = () => new Promise<void>((r) => setTimeout(r, 0));
    const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const p2025 = () => Object.assign(new Error("Record to update not found"), { code: "P2025" });
    const sameRef = (a: { userId: string; referenceId: string }, b: { userId: string; referenceId: string }) =>
        a.userId === b.userId && a.referenceId === b.referenceId;

    const prisma = {
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
            const staged = {
                ledger: [] as LedgerRow[],
                history: [] as HistoryRow[],
                deltas: new Map<string, { inc: number; unlock: boolean }>(),
            };
            const tx = {
                creditLedger: {
                    findUnique: async ({ where }: { where: { userId_referenceId: { userId: string; referenceId: string } } }) => {
                        await tick();
                        const key = where.userId_referenceId;
                        const hit = [...state.ledger, ...staged.ledger].find((l) => sameRef(l, key));
                        return hit ? { id: hit.id } : null;
                    },
                    create: async ({ data }: { data: Omit<LedgerRow, "id"> }) => {
                        await tick();
                        if (staged.ledger.some((l) => sameRef(l, data))) throw p2002();
                        const row = { id: `ledger_${++state.seq}`, ...data };
                        staged.ledger.push(row);
                        return row;
                    },
                },
                user: {
                    update: async ({ where, data }: { where: { id: string }; data: { credits: { increment: number }; creditsLockedAt?: null } }) => {
                        await tick();
                        const user = state.users.get(where.id);
                        if (!user) throw p2025();
                        const prev = staged.deltas.get(where.id) ?? { inc: 0, unlock: false };
                        const next = { inc: prev.inc + data.credits.increment, unlock: prev.unlock || data.creditsLockedAt === null };
                        staged.deltas.set(where.id, next);
                        return { credits: user.credits + next.inc };
                    },
                },
                creditHistory: {
                    create: async ({ data }: { data: HistoryRow }) => {
                        await tick();
                        if (state.failHistoryWrite) throw new Error("history write failed");
                        staged.history.push(data);
                        return data;
                    },
                },
            };

            const result = await fn(tx);

            // Commit: enforce the unique constraint against committed rows (this is
            // where a concurrent duplicate loses), then apply everything atomically.
            for (const row of staged.ledger) {
                if (state.ledger.some((l) => sameRef(l, row))) throw p2002();
            }
            state.ledger.push(...staged.ledger);
            state.history.push(...staged.history);
            for (const [id, d] of staged.deltas) {
                const user = state.users.get(id)!;
                user.credits += d.inc;
                if (d.unlock) user.creditsLockedAt = null;
            }
            return result;
        }),
        creditLedger: {
            findUnique: vi.fn(async ({ where }: { where: { userId_referenceId: { userId: string; referenceId: string } } }) => {
                const hit = state.ledger.find((l) => sameRef(l, where.userId_referenceId));
                return hit ? { id: hit.id } : null;
            }),
        },
        subscription: {
            findUnique: vi.fn(async () => null),
            findFirst: vi.fn(async () => null as null | { userId: string; stripePriceId: string | null }),
            upsert: vi.fn(async () => ({})),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
        user: {
            update: vi.fn(async () => ({})),
            findUnique: vi.fn(async () => null),
        },
        referral: { findUnique: vi.fn(), update: vi.fn() },
        commission: { findUnique: vi.fn(), create: vi.fn() },
    };

    const stripe = {
        checkout: { sessions: { listLineItems: vi.fn() } },
        subscriptions: { retrieve: vi.fn() },
    };

    return { state, prisma, stripe, bumpSessionVersion: vi.fn(async () => undefined) };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/stripe/client", () => ({ stripe: h.stripe }));
vi.mock("@/lib/session-version", () => ({ bumpSessionVersion: h.bumpSessionVersion }));
vi.mock("@/lib/redis", () => ({ redis: { set: vi.fn(async () => null) } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
    handleCheckoutCompleted,
    handleInvoicePaid,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
} from "@/lib/stripe/webhook";
import { grantCreditPackOnce, creditPackReferenceId } from "@/lib/stripe/credit-pack";
import { CREDIT_PACK } from "@/lib/stripe/plans";

const USER_ID = "user_1";
const PACK_PRICE = "price_credit_pack_test";
const START_CREDITS = 7;

function paymentSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
    return {
        id: "cs_test_1",
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        customer: null,
        subscription: null,
        metadata: { userId: USER_ID, purchaseType: "credit_pack" },
        ...overrides,
    } as unknown as Stripe.Checkout.Session;
}

function lineItems(items: Array<{ price: string | { id: string }; quantity: number }>) {
    return { object: "list", data: items, has_more: false };
}

function creditsOf(userId = USER_ID) {
    return h.state.users.get(userId)!.credits;
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_CREDIT_PACK_PRICE_ID = PACK_PRICE;
    process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";
    h.state.users.clear();
    h.state.users.set(USER_ID, { id: USER_ID, credits: START_CREDITS, creditsLockedAt: new Date("2026-01-01") });
    h.state.ledger.length = 0;
    h.state.history.length = 0;
    h.state.failHistoryWrite = false;
    h.stripe.checkout.sessions.listLineItems.mockResolvedValue(lineItems([{ price: { id: PACK_PRICE }, quantity: 1 }]));
});

describe("credit-pack Checkout fulfillment", () => {
    it("grants exactly the configured amount for a paid session with the expected price", async () => {
        await handleCheckoutCompleted(paymentSession());

        expect(creditsOf()).toBe(START_CREDITS + CREDIT_PACK.credits);
        expect(h.state.ledger).toHaveLength(1);
        expect(h.state.ledger[0]).toMatchObject({
            userId: USER_ID,
            amount: CREDIT_PACK.credits,
            type: "PURCHASE",
            referenceId: creditPackReferenceId("cs_test_1"),
        });
        expect(h.state.history).toHaveLength(1);
        expect(h.state.history[0]).toMatchObject({
            action: "credit_pack_purchase",
            cost: -CREDIT_PACK.credits,
            balanceAfter: START_CREDITS + CREDIT_PACK.credits,
            metadata: { stripeSessionId: "cs_test_1" },
        });
        // Existing policy preserved: purchase unlocks credits.
        expect(h.state.users.get(USER_ID)!.creditsLockedAt).toBeNull();
        expect(h.bumpSessionVersion).toHaveBeenCalledWith(USER_ID);
    });

    it("accepts the line-item price as a plain ID string (union handling)", async () => {
        h.stripe.checkout.sessions.listLineItems.mockResolvedValue(lineItems([{ price: PACK_PRICE, quantity: 1 }]));
        await handleCheckoutCompleted(paymentSession());
        expect(creditsOf()).toBe(START_CREDITS + CREDIT_PACK.credits);
    });

    it("fulfills legacy sessions created before purchaseType metadata existed", async () => {
        await handleCheckoutCompleted(paymentSession({ metadata: { userId: USER_ID } }));
        expect(creditsOf()).toBe(START_CREDITS + CREDIT_PACK.credits);
    });

    it("does not change credits twice on duplicate delivery of the same session", async () => {
        await handleCheckoutCompleted(paymentSession());
        await handleCheckoutCompleted(paymentSession());

        expect(creditsOf()).toBe(START_CREDITS + CREDIT_PACK.credits);
        expect(h.state.ledger).toHaveLength(1);
        expect(h.state.history).toHaveLength(1);
        expect(h.bumpSessionVersion).toHaveBeenCalledTimes(1);
    });

    it("does not create two grants for two concurrent deliveries", async () => {
        await Promise.all([
            handleCheckoutCompleted(paymentSession()),
            handleCheckoutCompleted(paymentSession()),
        ]);

        expect(creditsOf()).toBe(START_CREDITS + CREDIT_PACK.credits);
        expect(h.state.ledger).toHaveLength(1);
        expect(h.state.history).toHaveLength(1);
    });

    it("grants separately for two different paid sessions", async () => {
        await handleCheckoutCompleted(paymentSession({ id: "cs_a" }));
        await handleCheckoutCompleted(paymentSession({ id: "cs_b" }));
        expect(creditsOf()).toBe(START_CREDITS + 2 * CREDIT_PACK.credits);
    });

    it.each(["unpaid", "no_payment_required"] as const)("grants zero credits when payment_status is %s", async (status) => {
        await handleCheckoutCompleted(paymentSession({ payment_status: status }));

        expect(creditsOf()).toBe(START_CREDITS);
        expect(h.state.ledger).toHaveLength(0);
        expect(h.stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled();
    });

    it.each([
        ["a different price", [{ price: { id: "price_other" }, quantity: 1 }]],
        ["multiple line items", [{ price: { id: PACK_PRICE }, quantity: 1 }, { price: { id: PACK_PRICE }, quantity: 1 }]],
        ["quantity other than one", [{ price: { id: PACK_PRICE }, quantity: 2 }]],
        ["no line items", []],
    ])("raises an operational error and grants zero for %s", async (_label, items) => {
        h.stripe.checkout.sessions.listLineItems.mockResolvedValue(lineItems(items));

        await expect(handleCheckoutCompleted(paymentSession())).rejects.toThrow(/Unexpected line item/);
        expect(creditsOf()).toBe(START_CREDITS);
        expect(h.state.ledger).toHaveLength(0);
    });

    it("rejects an unexpected purchaseType label", async () => {
        await expect(
            handleCheckoutCompleted(paymentSession({ metadata: { userId: USER_ID, purchaseType: "other" } })),
        ).rejects.toThrow(/purchaseType/);
        expect(creditsOf()).toBe(START_CREDITS);
    });

    it("throws (retryable, visible) when user metadata cannot be resolved", async () => {
        await expect(handleCheckoutCompleted(paymentSession({ metadata: {} }))).rejects.toThrow(/missing user metadata/);
        expect(h.state.ledger).toHaveLength(0);
    });

    it("throws (retryable, visible) when the configured price is missing", async () => {
        delete process.env.STRIPE_CREDIT_PACK_PRICE_ID;
        await expect(handleCheckoutCompleted(paymentSession())).rejects.toThrow(/configured price/);
        expect(creditsOf()).toBe(START_CREDITS);
    });

    it("throws (retryable, visible) when Stripe line-item retrieval fails", async () => {
        h.stripe.checkout.sessions.listLineItems.mockRejectedValue(new Error("Stripe unavailable"));
        await expect(handleCheckoutCompleted(paymentSession())).rejects.toThrow(/Stripe unavailable/);
        expect(creditsOf()).toBe(START_CREDITS);
    });

    it("throws and leaves no ledger row when the user does not exist", async () => {
        await expect(
            handleCheckoutCompleted(paymentSession({ metadata: { userId: "ghost_user" } })),
        ).rejects.toMatchObject({ code: "P2025" });
        expect(h.state.ledger).toHaveLength(0);
    });

    it("rolls back the grant and ledger row atomically if the history write fails", async () => {
        h.state.failHistoryWrite = true;
        await expect(handleCheckoutCompleted(paymentSession())).rejects.toThrow(/history write failed/);

        expect(creditsOf()).toBe(START_CREDITS);
        expect(h.state.ledger).toHaveLength(0);

        // A retry after the transient failure then succeeds exactly once.
        h.state.failHistoryWrite = false;
        await handleCheckoutCompleted(paymentSession());
        expect(creditsOf()).toBe(START_CREDITS + CREDIT_PACK.credits);
    });
});

describe("grantCreditPackOnce input validation", () => {
    it.each([0, -5, 1.5, Number.NaN])("rejects invalid amount %s", async (amount) => {
        await expect(grantCreditPackOnce(USER_ID, "cs_x", amount)).rejects.toThrow(/Invalid credit-pack amount/);
    });

    it("rejects an empty session ID so grants cannot collapse onto one reference", async () => {
        await expect(grantCreditPackOnce(USER_ID, "", 50)).rejects.toThrow(/sessionId/);
        expect(h.state.ledger).toHaveLength(0);
    });
});

describe("subscription Checkout and invoice.paid", () => {
    it("still upgrades the plan for a subscription Checkout", async () => {
        h.stripe.subscriptions.retrieve.mockResolvedValue({
            status: "active",
            cancel_at_period_end: false,
            items: { data: [{ price: { id: "price_pro_test" }, current_period_end: 1_900_000_000 }] },
        });

        await handleCheckoutCompleted({
            id: "cs_sub_1",
            mode: "subscription",
            subscription: "sub_1",
            customer: "cus_1",
            metadata: { userId: USER_ID },
        } as unknown as Stripe.Checkout.Session);

        expect(h.prisma.subscription.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ where: { userId: USER_ID } }),
        );
        expect(h.prisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: USER_ID }, data: expect.objectContaining({ subscriptionTier: "PRO" }) }),
        );
        expect(h.stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled();
        expect(h.state.ledger).toHaveLength(0);
    });

    it("treats a subscription-mode session without a subscription as a failure", async () => {
        await expect(
            handleCheckoutCompleted({
                id: "cs_sub_missing",
                mode: "subscription",
                subscription: null,
                customer: "cus_1",
                metadata: { userId: USER_ID },
            } as unknown as Stripe.Checkout.Session),
        ).rejects.toThrow(/has no subscription/);
    });

    it("invoice.paid does not grant the same credit pack a second time", async () => {
        await handleCheckoutCompleted(paymentSession());
        expect(creditsOf()).toBe(START_CREDITS + CREDIT_PACK.credits);

        h.prisma.subscription.findFirst.mockResolvedValue({ userId: USER_ID, stripePriceId: "price_pro_test" });
        await handleInvoicePaid({
            id: "in_1",
            customer: "cus_1",
            amount_paid: 900,
            lines: { data: [{ price: { id: PACK_PRICE } }] },
        } as unknown as Stripe.Invoice);

        expect(creditsOf()).toBe(START_CREDITS + CREDIT_PACK.credits);
        expect(h.state.ledger).toHaveLength(1);
        // The credit-pack invoice must not fall through to tier/commission logic.
        expect(h.prisma.user.update).not.toHaveBeenCalled();
        expect(h.prisma.subscription.updateMany).not.toHaveBeenCalled();
    });
});

// PR 2 §2.3: a known event type that fails a required invariant must throw (so the
// event becomes RETRY_PENDING), not return early and get marked PROCESSED.
describe("required invariants are retryable, intentional ignores are not", () => {
    beforeEach(() => {
        h.prisma.subscription.findUnique.mockResolvedValue(null);
        h.prisma.subscription.findFirst.mockResolvedValue(null);
    });

    it("subscription Checkout with an unresolvable user throws", async () => {
        await expect(
            handleCheckoutCompleted({
                id: "cs_sub_nouser",
                mode: "subscription",
                subscription: "sub_1",
                customer: "cus_unknown",
                metadata: {},
            } as unknown as Stripe.Checkout.Session),
        ).rejects.toThrow(/could not resolve userId/);
    });

    it("customer.subscription.updated with an unresolvable user throws", async () => {
        await expect(
            handleSubscriptionUpdated({
                id: "sub_x",
                customer: "cus_unknown",
                metadata: {},
                items: { data: [] },
            } as unknown as Stripe.Subscription),
        ).rejects.toThrow(/could not resolve userId/);
    });

    it("customer.subscription.deleted with an unresolvable user throws", async () => {
        await expect(
            handleSubscriptionDeleted({
                id: "sub_x",
                customer: "cus_unknown",
                metadata: {},
            } as unknown as Stripe.Subscription),
        ).rejects.toThrow(/could not resolve userId/);
    });

    it("invoice.paid for a customer with no local subscription is an intentional ignore", async () => {
        await expect(
            handleInvoicePaid({ id: "in_orphan", customer: "cus_unknown", lines: { data: [] } } as unknown as Stripe.Invoice),
        ).resolves.toBeUndefined();
        expect(h.prisma.user.update).not.toHaveBeenCalled();
    });
});
