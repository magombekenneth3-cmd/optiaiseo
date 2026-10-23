import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    balance: 25,
    ledger: new Map<string, { userId: string; amount: number; type: string; referenceId: string }>(),
    histories: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/prisma", () => {
    const keyFrom = (args: any) => args.where.userId_referenceId.referenceId as string;
    const tx = {
        creditLedger: {
            findUnique: vi.fn(async (args: any) => state.ledger.get(keyFrom(args)) ?? null),
            create: vi.fn(async ({ data }: any) => {
                if (state.ledger.has(data.referenceId)) throw Object.assign(new Error("unique"), { code: "P2002" });
                state.ledger.set(data.referenceId, data);
                return data;
            }),
        },
        creditHistory: {
            create: vi.fn(async ({ data }: any) => { state.histories.push(data); return data; }),
        },
        user: {
            findUnique: vi.fn(async () => ({ credits: state.balance, creditsLockedAt: null })),
            update: vi.fn(async ({ data }: any) => {
                state.balance += data.credits.increment;
                return { credits: state.balance };
            }),
        },
        $queryRaw: vi.fn(async (_query: TemplateStringsArray, cost: number) => {
            if (state.balance < cost) return [];
            state.balance -= cost;
            return [{ credits: state.balance }];
        }),
    };
    return {
        prisma: {
            $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
            creditLedger: tx.creditLedger,
            user: {
                findUnique: vi.fn(async () => ({ credits: state.balance })),
            },
        },
    };
});

import { consumeCreditsIdempotent, refundCreditsIdempotent } from "@/lib/credits";

describe("idempotent background-job credits", () => {
    beforeEach(() => {
        state.balance = 25;
        state.ledger.clear();
        state.histories.length = 0;
    });

    it("charges a retried attempt only once and writes a matching audit record", async () => {
        const first = await consumeCreditsIdempotent("user-1", "blog_generation", "blog-generation:blog-1:attempt-1");
        const recovered = await consumeCreditsIdempotent("user-1", "blog_generation", "blog-generation:blog-1:attempt-1");

        expect(first).toMatchObject({ allowed: true, remaining: 15, cost: 10 });
        expect(recovered).toMatchObject({ allowed: true, remaining: 15, cost: 10 });
        expect(state.balance).toBe(15);
        expect(state.ledger.size).toBe(1);
        expect(state.histories).toHaveLength(1);
    });

    it("refunds a failed attempt once even if failure handling runs again", async () => {
        await consumeCreditsIdempotent("user-1", "blog_generation", "blog-generation:blog-1:attempt-1");

        const first = await refundCreditsIdempotent("user-1", 10, "refund:blog-generation:blog-1:attempt-1", "failed attempt");
        const repeated = await refundCreditsIdempotent("user-1", 10, "refund:blog-generation:blog-1:attempt-1", "failed attempt");

        expect(first).toMatchObject({ success: true, refunded: true });
        expect(repeated).toMatchObject({ success: true, refunded: false });
        expect(state.balance).toBe(25);
    });
});
