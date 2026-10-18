/**
 * PR 4 — audit credit charging at job creation, plus idempotent refunds.
 *
 * In-memory Prisma fake (same approach as stripe-credit-pack.test.ts): writes are
 * staged per transaction and the CreditLedger @@unique([userId, referenceId]) is
 * enforced at commit, so duplicate/concurrent calls behave like Postgres would.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
    type LedgerRow = { id: string; userId: string; referenceId: string; amount: number; type: string; reason?: string | null };
    type HistoryRow = { userId: string; action: string; label: string; cost: number; balanceAfter: number; metadata?: unknown };
    type UserRow = { id: string; credits: number; creditsLockedAt: Date | null };
    type AuditRow = { id: string; fixStatus: string; userId: string };

    const state = {
        users: new Map<string, UserRow>(),
        audits: new Map<string, AuditRow>(),
        ledger: [] as LedgerRow[],
        history: [] as HistoryRow[],
        failHistoryWrite: false,
        seq: 0,
    };

    const tick = () => new Promise<void>((r) => setTimeout(r, 0));
    const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const sameRef = (a: { userId: string; referenceId: string }, b: { userId: string; referenceId: string }) =>
        a.userId === b.userId && a.referenceId === b.referenceId;

    const prisma = {
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
            const staged = { ledger: [] as LedgerRow[], history: [] as HistoryRow[], deltas: new Map<string, number>() };
            const balance = (id: string) => state.users.get(id)!.credits + (staged.deltas.get(id) ?? 0);

            const tx = {
                creditLedger: {
                    findUnique: async ({ where }: { where: { userId_referenceId: { userId: string; referenceId: string } } }) => {
                        await tick();
                        const hit = [...state.ledger, ...staged.ledger].find((l) => sameRef(l, where.userId_referenceId));
                        return hit ? { id: hit.id, amount: hit.amount } : null;
                    },
                    create: async ({ data }: { data: Omit<LedgerRow, "id"> }) => {
                        await tick();
                        if (staged.ledger.some((l) => sameRef(l, data))) throw p2002();
                        const row = { id: `ledger_${++state.seq}`, ...data };
                        staged.ledger.push(row);
                        return row;
                    },
                },
                // Conditional decrement: UPDATE ... WHERE credits >= cost AND locked IS NULL RETURNING credits
                $queryRaw: async (_strings: TemplateStringsArray, cost: number, userId: string) => {
                    await tick();
                    const user = state.users.get(userId);
                    if (!user || user.creditsLockedAt || balance(userId) < cost) return [];
                    staged.deltas.set(userId, (staged.deltas.get(userId) ?? 0) - cost);
                    return [{ credits: balance(userId) }];
                },
                user: {
                    findUnique: async ({ where }: { where: { id: string } }) => {
                        const u = state.users.get(where.id);
                        return u ? { credits: balance(u.id), creditsLockedAt: u.creditsLockedAt } : null;
                    },
                    update: async ({ where, data }: { where: { id: string }; data: { credits: { increment: number } } }) => {
                        await tick();
                        staged.deltas.set(where.id, (staged.deltas.get(where.id) ?? 0) + data.credits.increment);
                        return { credits: balance(where.id) };
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

            for (const row of staged.ledger) {
                if (state.ledger.some((l) => sameRef(l, row))) throw p2002();
            }
            state.ledger.push(...staged.ledger);
            state.history.push(...staged.history);
            for (const [id, d] of staged.deltas) state.users.get(id)!.credits += d;
            return result;
        }),
        audit: {
            findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
                const a = state.audits.get(where.id);
                return a ? { fixStatus: a.fixStatus, site: { userId: a.userId } } : null;
            }),
        },
    };

    return { state, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
    chargeAuditCreditsOnce,
    refundAuditCreditsOnce,
    refundAuditIfFailed,
    auditChargeReferenceId,
    auditRefundReferenceId,
} from "@/lib/credits/audit-billing";
import { CREDIT_COSTS } from "@/lib/credits/constants";

const USER = "user_1";
const AUDIT = "caudit000000000000000001";
const COST = CREDIT_COSTS.full_site_audit;
const START = 25;

const credits = () => h.state.users.get(USER)!.credits;

beforeEach(() => {
    vi.clearAllMocks();
    h.state.users.clear();
    h.state.audits.clear();
    h.state.users.set(USER, { id: USER, credits: START, creditsLockedAt: null });
    h.state.ledger.length = 0;
    h.state.history.length = 0;
    h.state.failHistoryWrite = false;
});

describe("chargeAuditCreditsOnce", () => {
    it("deducts the audit cost once and records ledger + history together", async () => {
        const res = await chargeAuditCreditsOnce(USER, AUDIT);

        expect(res).toEqual({ charged: true, alreadyCharged: false, cost: COST, remaining: START - COST });
        expect(credits()).toBe(START - COST);
        expect(h.state.ledger).toEqual([
            expect.objectContaining({ userId: USER, amount: -COST, type: "CHARGE", referenceId: auditChargeReferenceId(AUDIT) }),
        ]);
        expect(h.state.history).toEqual([
            expect.objectContaining({ action: "full_site_audit", cost: COST, balanceAfter: START - COST, metadata: { auditId: AUDIT } }),
        ]);
    });

    it("is a no-op on repeat calls for the same audit (retries / repeated result views)", async () => {
        await chargeAuditCreditsOnce(USER, AUDIT);
        const again = await chargeAuditCreditsOnce(USER, AUDIT);
        await chargeAuditCreditsOnce(USER, AUDIT);

        expect(again).toMatchObject({ charged: true, alreadyCharged: true });
        expect(credits()).toBe(START - COST);
        expect(h.state.ledger).toHaveLength(1);
        expect(h.state.history).toHaveLength(1);
    });

    it("charges once under concurrent calls for the same audit", async () => {
        const results = await Promise.all([1, 2, 3].map(() => chargeAuditCreditsOnce(USER, AUDIT)));

        expect(results.filter((r) => r.charged && !r.alreadyCharged)).toHaveLength(1);
        expect(credits()).toBe(START - COST);
        expect(h.state.ledger).toHaveLength(1);
    });

    it("charges separately for different audits", async () => {
        await chargeAuditCreditsOnce(USER, "caudit_a");
        await chargeAuditCreditsOnce(USER, "caudit_b");
        expect(credits()).toBe(START - 2 * COST);
    });

    it("rejects with insufficient_credits and writes nothing", async () => {
        h.state.users.get(USER)!.credits = COST - 1;

        const res = await chargeAuditCreditsOnce(USER, AUDIT);

        expect(res).toEqual({ charged: false, reason: "insufficient_credits", cost: COST, remaining: COST - 1 });
        expect(credits()).toBe(COST - 1);
        expect(h.state.ledger).toHaveLength(0);
        expect(h.state.history).toHaveLength(0);
    });

    it("rejects with credits_locked when credits are locked", async () => {
        h.state.users.get(USER)!.creditsLockedAt = new Date();

        const res = await chargeAuditCreditsOnce(USER, AUDIT);

        expect(res).toMatchObject({ charged: false, reason: "credits_locked" });
        expect(credits()).toBe(START);
    });

    it("rolls back the deduction if the history write fails", async () => {
        h.state.failHistoryWrite = true;
        await expect(chargeAuditCreditsOnce(USER, AUDIT)).rejects.toThrow(/history write failed/);
        expect(credits()).toBe(START);
        expect(h.state.ledger).toHaveLength(0);
    });

    it("requires both identifiers so charges cannot collapse onto one reference", async () => {
        await expect(chargeAuditCreditsOnce(USER, "")).rejects.toThrow(/auditId/);
    });
});

describe("refundAuditCreditsOnce", () => {
    it("refunds exactly the charged amount once", async () => {
        await chargeAuditCreditsOnce(USER, AUDIT);

        const res = await refundAuditCreditsOnce(USER, AUDIT, "failed");

        expect(res).toEqual({ refunded: true, amount: COST, balance: START });
        expect(credits()).toBe(START);
        expect(h.state.ledger[1]).toMatchObject({ amount: COST, type: "REFUND", referenceId: auditRefundReferenceId(AUDIT) });
        expect(h.state.history[1]).toMatchObject({ label: "REFUND: Full Site Audit", cost: -COST, balanceAfter: START });
    });

    it("never refunds twice, sequentially or concurrently", async () => {
        await chargeAuditCreditsOnce(USER, AUDIT);

        await refundAuditCreditsOnce(USER, AUDIT, "a");
        const results = await Promise.all([1, 2, 3].map(() => refundAuditCreditsOnce(USER, AUDIT, "b")));

        expect(results.every((r) => !r.refunded)).toBe(true);
        expect(credits()).toBe(START);
        expect(h.state.ledger.filter((l) => l.type === "REFUND")).toHaveLength(1);
    });

    it("concurrent first refunds produce exactly one refund", async () => {
        await chargeAuditCreditsOnce(USER, AUDIT);
        const results = await Promise.all([1, 2].map(() => refundAuditCreditsOnce(USER, AUDIT, "x")));
        expect(results.filter((r) => r.refunded)).toHaveLength(1);
        expect(credits()).toBe(START);
    });

    it("does not mint credits for an audit that was never charged", async () => {
        const res = await refundAuditCreditsOnce(USER, AUDIT, "failed");

        expect(res).toEqual({ refunded: false, reason: "not_charged" });
        expect(credits()).toBe(START);
        expect(h.state.ledger).toHaveLength(0);
    });

    it("a refunded audit is not charged again on later result views", async () => {
        await chargeAuditCreditsOnce(USER, AUDIT);
        await refundAuditCreditsOnce(USER, AUDIT, "failed");
        const view = await chargeAuditCreditsOnce(USER, AUDIT);

        expect(view).toMatchObject({ charged: true, alreadyCharged: true });
        expect(credits()).toBe(START);
    });
});

describe("refundAuditIfFailed", () => {
    beforeEach(async () => {
        await chargeAuditCreditsOnce(USER, AUDIT);
    });

    it("refunds a charged FAILED audit to the site owner", async () => {
        h.state.audits.set(AUDIT, { id: AUDIT, fixStatus: "FAILED", userId: USER });
        expect(await refundAuditIfFailed(AUDIT, "timed out")).toMatchObject({ refunded: true, amount: COST });
        expect(credits()).toBe(START);
    });

    it.each(["COMPLETED", "PARTIAL", "IN_PROGRESS", "PENDING"])("does not refund a %s audit", async (status) => {
        h.state.audits.set(AUDIT, { id: AUDIT, fixStatus: status, userId: USER });
        expect(await refundAuditIfFailed(AUDIT, "x")).toEqual({ refunded: false, reason: "not_failed" });
        expect(credits()).toBe(START - COST);
    });

    it("is safe to call from every failure path for the same audit", async () => {
        h.state.audits.set(AUDIT, { id: AUDIT, fixStatus: "FAILED", userId: USER });
        await Promise.all([
            refundAuditIfFailed(AUDIT, "onFailure"),
            refundAuditIfFailed(AUDIT, "all pages failed"),
            refundAuditIfFailed(AUDIT, "stuck sweep"),
        ]);
        await refundAuditIfFailed(AUDIT, "stuck sweep again");
        expect(credits()).toBe(START);
        expect(h.state.ledger.filter((l) => l.type === "REFUND")).toHaveLength(1);
    });

    it("reports a missing audit", async () => {
        expect(await refundAuditIfFailed("cmissing", "x")).toEqual({ refunded: false, reason: "audit_not_found" });
    });
});
