/**
 * PR 2 — Stripe webhook crash recovery.
 *
 * In-memory WebhookEvent store that evaluates the same where-clauses the code
 * uses (equality, `null`, `{ lt }`, `OR`) and enforces @@unique(provider,
 * providerEventId). Handlers are mocked so each test controls success/failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

const h = vi.hoisted(() => {
    type Row = {
        id: string;
        provider: string;
        providerEventId: string;
        eventType: string;
        payload: unknown;
        status: string;
        processedAt: Date | null;
        claimedAt: Date | null;
        attempts: number;
        lastError: string | null;
        createdAt: Date;
        updatedAt: Date;
    };
    type Where = Record<string, unknown> & { OR?: Where[] };

    const rows: Row[] = [];
    let seq = 0;

    function matchField(value: unknown, cond: unknown): boolean {
        if (cond === null) return value === null || value === undefined;
        if (cond && typeof cond === "object" && !(cond instanceof Date) && "lt" in (cond as object)) {
            return value instanceof Date && value < (cond as { lt: Date }).lt;
        }
        return value === cond;
    }
    function matches(row: Row, where: Where): boolean {
        for (const [key, cond] of Object.entries(where)) {
            if (key === "OR") {
                if (!(cond as Where[]).some((w) => matches(row, w))) return false;
            } else if (key === "provider_providerEventId") {
                const k = cond as { provider: string; providerEventId: string };
                if (row.provider !== k.provider || row.providerEventId !== k.providerEventId) return false;
            } else if (!matchField((row as Record<string, unknown>)[key], cond)) {
                return false;
            }
        }
        return true;
    }
    function apply(row: Row, data: Record<string, unknown>) {
        for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === "object" && "increment" in (value as object)) {
                (row as Record<string, unknown>)[key] = ((row as Record<string, unknown>)[key] as number) + (value as { increment: number }).increment;
            } else {
                (row as Record<string, unknown>)[key] = value;
            }
        }
        row.updatedAt = new Date();
    }

    const webhookEvent = {
        create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
            if (rows.some((r) => r.provider === data.provider && r.providerEventId === data.providerEventId)) {
                throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
            }
            const now = new Date();
            const row: Row = {
                id: `we_${++seq}`,
                provider: data.provider!,
                providerEventId: data.providerEventId!,
                eventType: data.eventType!,
                payload: data.payload,
                status: data.status ?? "RECEIVED",
                processedAt: null,
                claimedAt: data.claimedAt ?? null,
                attempts: data.attempts ?? 0,
                lastError: null,
                createdAt: now,
                updatedAt: now,
            };
            rows.push(row);
            return row;
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
            const hit = rows.filter((r) => matches(r, where));
            hit.forEach((r) => apply(r, data));
            return { count: hit.length };
        }),
        update: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
            const row = rows.find((r) => matches(r, where));
            if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" });
            apply(row, data);
            return row;
        }),
        findUnique: vi.fn(async ({ where }: { where: Where }) => rows.find((r) => matches(r, where)) ?? null),
        findMany: vi.fn(async ({ where, take }: { where: Where; take?: number }) =>
            rows
                .filter((r) => matches(r, where))
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                .slice(0, take ?? rows.length),
        ),
    };

    const handlers = {
        handleCheckoutCompleted: vi.fn(async () => undefined),
        handleSubscriptionUpdated: vi.fn(async () => undefined),
        handleSubscriptionDeleted: vi.fn(async () => undefined),
        handlePaymentFailed: vi.fn(async () => undefined),
        handleInvoicePaid: vi.fn(async () => undefined),
    };

    return {
        rows,
        prisma: { webhookEvent },
        handlers,
        constructEvent: vi.fn(),
        rateLimit: vi.fn(async () => null),
    };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/stripe/webhook", () => h.handlers);
vi.mock("@/lib/stripe/client", () => ({ stripe: { webhooks: { constructEvent: h.constructEvent } } }));
vi.mock("@/lib/rate-limit/check", () => ({ rateLimit: h.rateLimit, getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { POST } from "@/app/api/webhooks/stripe/route";
import {
    claimExistingStripeEvent,
    reconcileStaleStripeEvents,
    STALE_CLAIM_MS,
    MAX_RECONCILE_ATTEMPTS,
} from "@/lib/stripe/webhook-events";

function stripeEvent(id = "evt_1", type = "invoice.paid"): Stripe.Event {
    return { id, type, object: "event", data: { object: { id: `obj_${id}` } } } as unknown as Stripe.Event;
}

function deliver(event: Stripe.Event) {
    h.constructEvent.mockReturnValueOnce(event);
    return POST(
        new Request("http://localhost/api/webhooks/stripe", {
            method: "POST",
            body: JSON.stringify(event),
            headers: { "stripe-signature": "t=1,v1=sig" },
        }) as never,
    );
}

function row(id = "evt_1") {
    return h.rows.find((r) => r.providerEventId === id)!;
}

function seedRow(overrides: Partial<(typeof h.rows)[number]> & { providerEventId: string }) {
    const now = new Date();
    h.rows.push({
        id: `seed_${overrides.providerEventId}`,
        provider: "stripe",
        eventType: "invoice.paid",
        payload: stripeEvent(overrides.providerEventId),
        status: "RECEIVED",
        processedAt: null,
        claimedAt: now,
        attempts: 1,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    });
}

const ago = (ms: number) => new Date(Date.now() - ms);

beforeEach(() => {
    vi.clearAllMocks();
    h.rows.length = 0;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    Object.values(h.handlers).forEach((fn) => fn.mockResolvedValue(undefined));
});

describe("webhook route — claim lifecycle", () => {
    it("inserts a new event with claim metadata and marks it PROCESSED on success", async () => {
        const res = await deliver(stripeEvent());

        expect(res.status).toBe(200);
        expect(h.prisma.webhookEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: "RECEIVED", attempts: 1, claimedAt: expect.any(Date) }) }),
        );
        expect(row()).toMatchObject({ status: "PROCESSED", claimedAt: null, lastError: null, attempts: 1 });
        expect(row().processedAt).toBeInstanceOf(Date);
        expect(h.handlers.handleInvoicePaid).toHaveBeenCalledTimes(1);
    });

    it("rejects an invalid signature before touching the database", async () => {
        h.constructEvent.mockImplementationOnce(() => { throw new Error("bad sig"); });
        const res = await POST(
            new Request("http://localhost/api/webhooks/stripe", {
                method: "POST",
                body: "{}",
                headers: { "stripe-signature": "bad" },
            }) as never,
        );
        expect(res.status).toBe(400);
        expect(h.prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it("acknowledges a duplicate of a PROCESSED event without reprocessing", async () => {
        await deliver(stripeEvent());
        const res = await deliver(stripeEvent());

        expect(res.status).toBe(200);
        expect(h.handlers.handleInvoicePaid).toHaveBeenCalledTimes(1);
    });

    it("returns 500 (retry) for a fresh in-progress RECEIVED event and does not mark it processed", async () => {
        seedRow({ providerEventId: "evt_busy", claimedAt: new Date() });

        const res = await deliver(stripeEvent("evt_busy"));

        expect(res.status).toBe(500);
        expect(h.handlers.handleInvoicePaid).not.toHaveBeenCalled();
        expect(row("evt_busy").status).toBe("RECEIVED");
    });

    it("recovers a stale RECEIVED event left by a crashed invocation", async () => {
        seedRow({ providerEventId: "evt_crashed", claimedAt: ago(STALE_CLAIM_MS + 60_000) });

        const res = await deliver(stripeEvent("evt_crashed"));

        expect(res.status).toBe(200);
        expect(h.handlers.handleInvoicePaid).toHaveBeenCalledTimes(1);
        expect(row("evt_crashed")).toMatchObject({ status: "PROCESSED", attempts: 2, claimedAt: null });
    });

    it("recovers a legacy RECEIVED row (pre-migration, claimedAt NULL) once it is old enough", async () => {
        seedRow({ providerEventId: "evt_legacy", claimedAt: null, attempts: 0, createdAt: ago(STALE_CLAIM_MS + 60_000) });

        const res = await deliver(stripeEvent("evt_legacy"));

        expect(res.status).toBe(200);
        expect(row("evt_legacy").status).toBe("PROCESSED");
    });

    it("on handler failure: releases the claim, stores a truncated error, returns 500, then succeeds on retry", async () => {
        h.handlers.handleInvoicePaid.mockRejectedValueOnce(new Error("x".repeat(5000)));

        const first = await deliver(stripeEvent());
        expect(first.status).toBe(500);
        expect(row()).toMatchObject({ status: "RETRY_PENDING", claimedAt: null });
        expect(row().lastError!.length).toBeLessThanOrEqual(1000);

        const retry = await deliver(stripeEvent());
        expect(retry.status).toBe(200);
        expect(row()).toMatchObject({ status: "PROCESSED", attempts: 2, lastError: null });
    });

    it("marks unknown event types PROCESSED (no side effects) after logging", async () => {
        const res = await deliver(stripeEvent("evt_unknown", "customer.created"));
        expect(res.status).toBe(200);
        expect(row("evt_unknown").status).toBe("PROCESSED");
    });

    it("routes checkout.session.async_payment_succeeded to the checkout handler", async () => {
        await deliver(stripeEvent("evt_async", "checkout.session.async_payment_succeeded"));
        expect(h.handlers.handleCheckoutCompleted).toHaveBeenCalledTimes(1);
    });

    it("never routes checkout.session.async_payment_failed to the grant path", async () => {
        const res = await deliver(stripeEvent("evt_async_fail", "checkout.session.async_payment_failed"));
        expect(res.status).toBe(200);
        expect(h.handlers.handleCheckoutCompleted).not.toHaveBeenCalled();
    });
});

describe("claimExistingStripeEvent — exclusivity", () => {
    it("lets exactly one of several concurrent workers claim a RETRY_PENDING event", async () => {
        seedRow({ providerEventId: "evt_race", status: "RETRY_PENDING", claimedAt: null });

        const results = await Promise.all([
            claimExistingStripeEvent("evt_race"),
            claimExistingStripeEvent("evt_race"),
            claimExistingStripeEvent("evt_race"),
        ]);

        expect(results.filter((r) => r === "CLAIMED")).toHaveLength(1);
        expect(results.filter((r) => r === "IN_PROGRESS")).toHaveLength(2);
        expect(row("evt_race").attempts).toBe(2);
    });

    it("reports ALREADY_PROCESSED for a processed event", async () => {
        seedRow({ providerEventId: "evt_done", status: "PROCESSED", claimedAt: null });
        expect(await claimExistingStripeEvent("evt_done")).toBe("ALREADY_PROCESSED");
    });
});

describe("reconcileStaleStripeEvents", () => {
    it("replays stale RECEIVED events and leaves fresh ones alone", async () => {
        seedRow({ providerEventId: "evt_stale", claimedAt: ago(STALE_CLAIM_MS + 60_000) });
        seedRow({ providerEventId: "evt_fresh", claimedAt: new Date() });

        const summary = await reconcileStaleStripeEvents();

        expect(summary).toMatchObject({ scanned: 1, replayed: 1, succeeded: 1 });
        expect(row("evt_stale").status).toBe("PROCESSED");
        expect(row("evt_fresh").status).toBe("RECEIVED");
        expect(h.handlers.handleInvoicePaid).toHaveBeenCalledTimes(1);
    });

    it("replays idle RETRY_PENDING events but gives recent failures to Stripe's retry first", async () => {
        seedRow({ providerEventId: "evt_idle", status: "RETRY_PENDING", claimedAt: null, updatedAt: ago(STALE_CLAIM_MS + 60_000) });
        seedRow({ providerEventId: "evt_recent", status: "RETRY_PENDING", claimedAt: null, updatedAt: new Date() });

        const summary = await reconcileStaleStripeEvents();

        expect(summary.replayed).toBe(1);
        expect(row("evt_idle").status).toBe("PROCESSED");
        expect(row("evt_recent").status).toBe("RETRY_PENDING");
    });

    it("alerts instead of replaying events that exhausted their attempts", async () => {
        seedRow({
            providerEventId: "evt_exhausted",
            status: "RETRY_PENDING",
            claimedAt: null,
            attempts: MAX_RECONCILE_ATTEMPTS,
            updatedAt: ago(STALE_CLAIM_MS + 60_000),
        });

        const summary = await reconcileStaleStripeEvents();

        expect(summary).toMatchObject({ exhausted: 1, replayed: 0 });
        expect(h.handlers.handleInvoicePaid).not.toHaveBeenCalled();
    });

    it("records a failed replay as RETRY_PENDING", async () => {
        seedRow({ providerEventId: "evt_fails", claimedAt: ago(STALE_CLAIM_MS + 60_000) });
        h.handlers.handleInvoicePaid.mockRejectedValueOnce(new Error("still broken"));

        const summary = await reconcileStaleStripeEvents();

        expect(summary).toMatchObject({ replayed: 1, failed: 1 });
        expect(row("evt_fails")).toMatchObject({ status: "RETRY_PENDING", lastError: "still broken", claimedAt: null });
    });
});
