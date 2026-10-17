/**
 * PR 1 — Real-Postgres proof that a credit pack is granted once per Checkout Session.
 *
 * Mocked Prisma cannot prove database uniqueness behaviour, so this test runs the
 * real grantCreditPackOnce() against a real database and the real
 * CreditLedger @@unique([userId, referenceId]) constraint.
 *
 * SKIPPED by default. Run against an isolated TEST database only (never production):
 *   CREDIT_PACK_DB_TEST=true DATABASE_URL=postgres://.../optiaiseo_test \
 *     pnpm exec vitest run tests/integration/stripe-credit-pack.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const SHOULD_RUN = process.env.CREDIT_PACK_DB_TEST === "true";
const testIf = SHOULD_RUN ? it : it.skip;

describe("credit-pack grant — database integration", () => {
    const USER_ID = `test-credit-pack-${Date.now()}`;
    const START = 5;

    beforeAll(async () => {
        if (!SHOULD_RUN) return;
        const { prisma } = await import("@/lib/prisma");
        await prisma.user.create({
            data: {
                id: USER_ID,
                name: "Credit Pack DB Test",
                email: `${USER_ID}@test.local`,
                credits: START,
            },
        });
    });

    afterAll(async () => {
        if (!SHOULD_RUN) return;
        const { prisma } = await import("@/lib/prisma");
        // CreditLedger / CreditHistory cascade on user delete.
        await prisma.user.delete({ where: { id: USER_ID } }).catch(() => undefined);
        await prisma.$disconnect();
    });

    testIf("concurrent deliveries of one session produce exactly one grant", async () => {
        const { prisma } = await import("@/lib/prisma");
        const { grantCreditPackOnce } = await import("@/lib/stripe/credit-pack");

        const results = await Promise.all(
            Array.from({ length: 8 }, () => grantCreditPackOnce(USER_ID, "cs_db_concurrent", 50)),
        );

        expect(results.filter((r) => r.granted)).toHaveLength(1);

        const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID }, select: { credits: true } });
        expect(user.credits).toBe(START + 50);
        expect(await prisma.creditLedger.count({ where: { userId: USER_ID } })).toBe(1);
        expect(
            await prisma.creditHistory.count({ where: { userId: USER_ID, action: "credit_pack_purchase" } }),
        ).toBe(1);
    });

    testIf("a later duplicate delivery is a no-op", async () => {
        const { prisma } = await import("@/lib/prisma");
        const { grantCreditPackOnce } = await import("@/lib/stripe/credit-pack");

        const again = await grantCreditPackOnce(USER_ID, "cs_db_concurrent", 50);
        expect(again.granted).toBe(false);

        const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID }, select: { credits: true } });
        expect(user.credits).toBe(START + 50);
    });
});
