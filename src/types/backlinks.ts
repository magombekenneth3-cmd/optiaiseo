// src/types/backlinks.ts
// Single source of truth for all backlink-related types.
// Import from here instead of re-declaring in individual files.

import type { ProviderStatus } from "@/lib/aeo/provider-result";

export interface BacklinkSummary {
    totalBacklinks: number;
    referringDomains: number;
    domainRating: number;
    drDelta30d: number | null;
    newLastWeek: number;
    lostLastWeek: number;
    doFollowRatio: number | null;
    topLinkedPage: string | null;
    topAnchors: { anchor: string; count: number }[];
    brokenBacklinks: number;
    toxicCount: number;
    avgReferringDR: number | null;
    /** P0.5: Distinguishes "0 backlinks observed" from "provider unavailable" */
    providerStatus: ProviderStatus;
}

export interface BacklinkDetail {
    sourceUrl: string;
    sourceDomain: string;
    targetUrl: string;
    anchorText: string;
    domainRating: number;
    firstSeen: string;
    lastSeen: string;
    isDoFollow: boolean;
    spamScore: number;
    isToxic: boolean;
    status: "active" | "lost" | "broken";
}

export interface StoredBacklink {
    id: string;
    linkKey: string;
    srcDomain: string;
    sourceUrl: string;
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
    url: string;
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
