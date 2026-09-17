/**
 * Persists link-level observations and delegates all toxicity decisions to the
 * pure analyser in analysis.ts.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
    analyseBacklinkToxicity,
    type RawBacklink,
    type ToxicityOptions,
} from "./analysis";
import { createBacklinkLinkKey } from "./identity";

export type { RawBacklink };

export interface StoreBacklinkOptions extends ToxicityOptions {
    observedAt?: Date;
}

function cleanBacklink(backlink: RawBacklink): RawBacklink | null {
    const srcDomain = backlink.srcDomain.trim().toLowerCase();
    if (!srcDomain) return null;

    return {
        ...backlink,
        srcDomain,
        sourceUrl: backlink.sourceUrl?.trim() ?? "",
        targetUrl: backlink.targetUrl?.trim() ?? "",
        anchorText: backlink.anchorText.trim(),
    };
}

/** Runs toxicity detection and stores each observed backlink by stable link key. */
export async function analyseAndStoreBacklinks(
    siteId: string,
    backlinks: RawBacklink[],
    options: StoreBacklinkOptions = {},
): Promise<{ total: number; toxic: number }> {
    const byKey = new Map<string, RawBacklink>();
    for (const backlink of backlinks) {
        const clean = cleanBacklink(backlink);
        if (!clean) continue;
        const key = createBacklinkLinkKey({
            sourceUrl: clean.sourceUrl ?? "",
            targetUrl: clean.targetUrl ?? "",
            anchorText: clean.anchorText,
            srcDomain: clean.srcDomain,
        });
        byKey.set(key, clean);
    }

    const uniqueBacklinks = [...byKey.values()];
    if (uniqueBacklinks.length === 0) return { total: 0, toxic: 0 };

    const toxicity = analyseBacklinkToxicity(uniqueBacklinks, options);
    const observedAt = options.observedAt ?? new Date();
    let stored = 0;

    // Keep database pressure bounded for a 1000-link sync without making
    // multiple concurrent upserts race on the same unique index.
    const chunkSize = 25;
    for (let offset = 0; offset < uniqueBacklinks.length; offset += chunkSize) {
        const backlinksChunk = uniqueBacklinks.slice(offset, offset + chunkSize);
        const toxicityChunk = toxicity.slice(offset, offset + chunkSize);

        const results = await Promise.allSettled(backlinksChunk.map(async (backlink, index) => {
            const verdict = toxicityChunk[index]!;
            const linkKey = createBacklinkLinkKey({
                sourceUrl: backlink.sourceUrl ?? "",
                targetUrl: backlink.targetUrl ?? "",
                anchorText: backlink.anchorText,
                srcDomain: backlink.srcDomain,
            });

            await prisma.backlinkDetail.upsert({
                where: { siteId_linkKey: { siteId, linkKey } },
                create: {
                    siteId,
                    linkKey,
                    srcDomain: backlink.srcDomain,
                    sourceUrl: backlink.sourceUrl ?? "",
                    targetUrl: backlink.targetUrl ?? "",
                    anchorText: backlink.anchorText,
                    domainRating: backlink.domainRating ?? null,
                    isDoFollow: backlink.isDoFollow ?? false,
                    spamScore: backlink.spamScore ?? null,
                    isToxic: verdict.isToxic,
                    toxicReason: verdict.toxicReason,
                    status: backlink.status ?? "active",
                    firstSeen: backlink.firstSeen ?? observedAt,
                    lastSeen: backlink.lastSeen ?? observedAt,
                },
                update: {
                    srcDomain: backlink.srcDomain,
                    sourceUrl: backlink.sourceUrl ?? "",
                    targetUrl: backlink.targetUrl ?? "",
                    anchorText: backlink.anchorText,
                    domainRating: backlink.domainRating ?? null,
                    isDoFollow: backlink.isDoFollow ?? false,
                    spamScore: backlink.spamScore ?? null,
                    isToxic: verdict.isToxic,
                    toxicReason: verdict.toxicReason,
                    status: backlink.status ?? "active",
                    lastSeen: backlink.lastSeen ?? observedAt,
                },
            });
            return verdict;
        }));

        for (const result of results) {
            if (result.status === "fulfilled") {
                stored++;
            } else {
                logger.warn("[BacklinkDetail] Upsert failed", {
                    siteId,
                    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                });
            }
        }
    }

    const toxic = toxicity.filter((verdict) => verdict.isToxic).length;
    logger.info("[BacklinkDetail] Stored backlink observations", {
        siteId,
        observed: uniqueBacklinks.length,
        stored,
        toxic,
    });
    return { total: stored, toxic };
}

/** Fetch backlink quality totals for the active observed backlink inventory. */
export async function getBacklinkQualitySummary(siteId: string) {
    const active = { siteId, status: "active" };
    const [total, toxic, doFollow, byReason] = await Promise.all([
        prisma.backlinkDetail.count({ where: active }),
        prisma.backlinkDetail.count({ where: { ...active, isToxic: true } }),
        prisma.backlinkDetail.count({ where: { ...active, isDoFollow: true } }),
        prisma.backlinkDetail.groupBy({
            by: ["toxicReason"],
            where: { ...active, isToxic: true },
            _count: { id: true },
        }),
    ]);

    return {
        total,
        toxic,
        doFollow,
        nofollow: total - doFollow,
        toxicReasons: byReason.map((row) => ({
            reason: row.toxicReason,
            count: row._count.id,
        })),
    };
}
