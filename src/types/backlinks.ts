// src/types/backlinks.ts
// Single source of truth for all backlink-related types.
// Import from here instead of re-declaring in individual files.

export interface BacklinkSummary {
    totalBacklinks: number;
    referringDomains: number;
    domainRating: number;
    drDelta30d: number | null;
    newLastWeek: number;
    lostLastWeek: number;
    doFollowRatio: number;
    topLinkedPage: string | null;
    topAnchors: { anchor: string; count: number }[];
    brokenBacklinks: number;
    toxicCount: number;
    avgReferringDR: number | null;
}

export interface BacklinkDetail {
    sourceUrl: string;
    targetUrl: string;
    anchorText: string;
    domainRating: number;
    firstSeen: string;
    isToxic: boolean;
}

export interface StoredBacklink {
    id: string;
    srcDomain: string;
    targetUrl: string | null;
    anchorText: string;
    domainRating: number | null;
    isDoFollow: boolean;
    isToxic: boolean;
    toxicReason: string | null;
    spamScore: number | null;
    firstSeen: string;
    lastSeen: string;
    status: "active" | "lost" | "broken";
}

export interface BacklinkAlert {
    id: string;
    type: "gained" | "lost";
    domain: string;
    sourceUrl: string | null;
    dr: number | null;
    detectedAt: string;
}

export interface QualitySummary {
    total: number;
    toxic: number;
    doFollow: number;
    nofollow: number;
    toxicReasons: { reason: string | null; count: number }[];
}

export interface BacklinkOpportunity {
    domain: string;
    dr:     number;
}

export interface BacklinkMetricGap {
    /** Positive = competitor leads; negative = you lead */
    totalBacklinks: number;
    referringDomains: number;
    domainRating: number;
    /**
     * Referring domains that link to the competitor but NOT to you,
     * with their domain rating included for outreach prioritisation.
     * Sorted by DR descending — highest-authority targets first.
     */
    opportunityDomains: BacklinkOpportunity[];
}

export interface BacklinkGapReport {
    yourDomain: string;
    competitorDomain: string;
    you: BacklinkSummary;
    competitor: BacklinkSummary;
    gap: BacklinkMetricGap;
    fetchedAt: string;
}
