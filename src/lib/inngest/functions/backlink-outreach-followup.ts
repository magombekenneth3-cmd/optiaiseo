/**
 * Inngest function: backlink-outreach-followup
 *
 * Runs daily at 09:00 UTC. Scans every PlannerItem across all active sites
 * and auto-transitions BacklinkTarget cards:
 *
 *   "Outreach Sent"  → "Following Up"   after FOLLOWUP_DAYS (default 7)
 *   "Following Up"   → "Rejected"       after STALE_DAYS    (default 21)
 *
 * Transitions are written back to the `backlinks` JSON column with a fresh
 * `movedAt` timestamp. No email/notification is sent here — that can be
 * added as a separate step if needed.
 */

import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import type { BacklinkTarget } from "@/types/planner";

// ── Tuneable thresholds ────────────────────────────────────────────────────────
const FOLLOWUP_DAYS = parseInt(process.env.BACKLINK_FOLLOWUP_DAYS ?? "7",  10);
const STALE_DAYS    = parseInt(process.env.BACKLINK_STALE_DAYS   ?? "21", 10);

function daysSince(iso?: string | null): number {
    if (!iso) return 0;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function advanceCard(card: BacklinkTarget, now: string): BacklinkTarget | null {
    const moved = daysSince(card.movedAt ?? card.contactedAt);

    if (card.status === "Outreach Sent" && moved >= FOLLOWUP_DAYS) {
        return { ...card, status: "Following Up", movedAt: now };
    }
    if (card.status === "Following Up" && moved >= STALE_DAYS) {
        return { ...card, status: "Rejected", movedAt: now };
    }
    return null; // no change
}

export const backlinkOutreachFollowupJob = inngest.createFunction(
    {
        id:      "backlink-outreach-followup",
        name:    "Backlinks: auto-advance stale outreach cards",
        retries: 2,
        triggers: [
            // Daily at 09:00 UTC
            { cron: "0 9 * * *" },
        ],
        // Concurrency limit prevents parallel runs during slow DB scans
        concurrency: { limit: 1, key: "\"global\"" },
    },
    async ({ step }) => {
        const now = new Date().toISOString();

        // Step 1 — collect all sites with Pro/Agency subs that have planner items
        const items = await step.run("fetch-planner-items", async () => {
            const { prisma } = await import("@/lib/prisma");
            return prisma.plannerItem.findMany({
                where: {
                    // Only process items that have at least one backlink target
                    NOT: { backlinks: { equals: [] as never } },
                    site: {
                        user: {
                            subscriptionTier: { in: ["PRO", "AGENCY"] },
                        },
                    },
                },
                select: { id: true, siteId: true, backlinks: true },
            }) as Promise<{ id: string; siteId: string; backlinks: unknown }[]>;
        });

        if (items.length === 0) {
            logger.info("[Inngest/BacklinkFollowup] No items to process");
            return { processed: 0, transitions: 0 };
        }

        // Step 2 — compute which cards need advancing (pure, no DB)
        type Patch = { id: string; backlinks: BacklinkTarget[] };
        const patches: Patch[] = [];

        for (const item of items) {
            const targets = (item.backlinks as BacklinkTarget[]) ?? [];
            if (!Array.isArray(targets) || targets.length === 0) continue;

            let changed = false;
            const updated = targets.map(card => {
                const next = advanceCard(card, now);
                if (next) { changed = true; return next; }
                return card;
            });

            if (changed) patches.push({ id: item.id, backlinks: updated });
        }

        if (patches.length === 0) {
            logger.info("[Inngest/BacklinkFollowup] No cards need advancing", {
                checked: items.length,
            });
            return { processed: items.length, transitions: 0 };
        }

        // Step 3 — write patches in a single transaction per batch of 20
        const transitions = await step.run("apply-patches", async () => {
            const { prisma } = await import("@/lib/prisma");
            const CHUNK = 20;
            let total = 0;

            for (let i = 0; i < patches.length; i += CHUNK) {
                const chunk = patches.slice(i, i + CHUNK);
                await prisma.$transaction(
                    chunk.map(p =>
                        prisma.plannerItem.update({
                            where: { id: p.id },
                            data:  { backlinks: p.backlinks as object[] },
                        })
                    )
                );
                total += chunk.reduce((s, p) => {
                    // Count how many cards actually changed
                    const orig = items.find(it => it.id === p.id);
                    const origTargets = (orig?.backlinks as BacklinkTarget[]) ?? [];
                    return s + p.backlinks.filter((b, idx) => b.status !== origTargets[idx]?.status).length;
                }, 0);
            }

            return total;
        });

        logger.info("[Inngest/BacklinkFollowup] Done", {
            checked: items.length,
            patchedItems: patches.length,
            transitions,
        });

        return { processed: items.length, transitions };
    }
);
