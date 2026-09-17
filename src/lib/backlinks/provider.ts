import type { BacklinkDetail } from "@/types/backlinks";

export type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as UnknownRecord
        : null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumberValue(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean {
    return value === true;
}

/**
 * DataForSEO documents timestamps as yyyy-mm-dd hh-mm-ss +00:00. JavaScript
 * does not reliably parse the hyphenated time component, so normalise it first.
 */
export function parseDataForSeoDate(value: unknown): Date | null {
    const raw = stringValue(value).trim();
    if (!raw) return null;

    const normalised = raw.replace(
        /^(\d{4}-\d{2}-\d{2})\s+(\d{2})-(\d{2})-(\d{2})\s*([+-]\d{2}:\d{2})$/,
        "$1T$2:$3:$4$5",
    );
    const date = new Date(normalised);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(value: unknown): string {
    return parseDataForSeoDate(value)?.toISOString() ?? "";
}

/** Extracts the first task result from the standard DataForSEO v3 envelope. */
export function getDataForSeoFirstResult(payload: unknown): UnknownRecord | null {
    const root = asRecord(payload);
    const task = asRecord(asArray(root?.tasks)[0]);
    return asRecord(asArray(task?.result)[0]);
}

export interface DataForSeoSummary {
    domainRating: number;
    totalBacklinks: number;
    referringDomains: number;
    brokenBacklinks: number;
}

/** Parses only fields actually returned by the summary endpoint. */
export function parseDataForSeoSummary(item: UnknownRecord): DataForSeoSummary {
    return {
        domainRating: numberValue(item.rank),
        totalBacklinks: numberValue(item.backlinks),
        referringDomains: numberValue(item.referring_domains),
        brokenBacklinks: numberValue(item.broken_backlinks),
    };
}

/** Parses one record from the backlinks endpoint. */
export function parseDataForSeoBacklink(item: UnknownRecord): BacklinkDetail {
    const sourceUrl = stringValue(item.url_from);
    const sourceDomain = stringValue(item.domain_from).trim().toLowerCase() || (() => {
        try {
            return new URL(sourceUrl).hostname.toLowerCase();
        } catch {
            return "";
        }
    })();

    const isLost = booleanValue(item.is_lost);
    const isBroken = booleanValue(item.is_broken);
    const spamScore = numberValue(item.backlink_spam_score);

    return {
        sourceUrl,
        sourceDomain,
        targetUrl: stringValue(item.url_to),
        anchorText: stringValue(item.anchor),
        // rank is passed by this backlink. The source-domain metric shown as
        // DR in the product is domain_from_rank.
        domainRating: numberValue(item.domain_from_rank),
        firstSeen: isoDate(item.first_seen),
        lastSeen: isoDate(item.last_seen),
        isDoFollow: booleanValue(item.dofollow),
        spamScore,
        isToxic: spamScore >= 60,
        status: isLost ? "lost" : isBroken ? "broken" : "active",
    };
}

export interface ReferringDomainRow {
    srcDomain: string;
    domainRating: number;
    backlinks: number;
    spamScore: number | null;
    /** ISO timestamp. Strings survive the Redis cache without a lossy Date cast. */
    firstSeen: string | null;
}

/** Parses one record from the referring-domains endpoint. */
export function parseDataForSeoReferringDomain(item: UnknownRecord): ReferringDomainRow {
    return {
        srcDomain: stringValue(item.domain).trim().toLowerCase(),
        domainRating: numberValue(item.rank),
        backlinks: numberValue(item.backlinks),
        spamScore: nullableNumberValue(item.backlinks_spam_score),
        firstSeen: isoDate(item.first_seen) || null,
    };
}
