import { TOXIC_KEYWORDS } from "./constants";

export interface RawBacklink {
    srcDomain: string;
    sourceUrl?: string;
    targetUrl?: string;
    anchorText: string;
    domainRating?: number | null;
    isDoFollow?: boolean;
    spamScore?: number | null;
    firstSeen?: Date;
    lastSeen?: Date;
    status?: "active" | "lost" | "broken";
}

export interface BacklinkToxicity {
    isToxic: boolean;
    toxicReason: string | null;
}

export interface ToxicityOptions {
    /** A site keyword allows exact-match detection without treating every common anchor as spam. */
    targetKeyword?: string | null;
}

/**
 * Conservative, explainable toxicity classifier.
 *
 * It deliberately does not mark blank anchors or generic repeated anchors as
 * toxic. Those were the source of mass false positives in the old pipeline.
 */
export function analyseBacklinkToxicity(
    backlinks: RawBacklink[],
    options: ToxicityOptions = {},
): BacklinkToxicity[] {
    const anchorCounts = new Map<string, number>();
    const domainCounts = new Map<string, number>();
    const targetKeyword = options.targetKeyword?.trim().toLowerCase() ?? "";

    for (const backlink of backlinks) {
        const anchor = backlink.anchorText.trim().toLowerCase();
        if (anchor) anchorCounts.set(anchor, (anchorCounts.get(anchor) ?? 0) + 1);

        const domain = backlink.srcDomain.trim().toLowerCase();
        if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }

    return backlinks.map((backlink) => {
        const anchor = backlink.anchorText.trim().toLowerCase();
        const domain = backlink.srcDomain.trim().toLowerCase();
        const anchorCount = anchor ? (anchorCounts.get(anchor) ?? 0) : 0;
        const domainCount = domain ? (domainCounts.get(domain) ?? 0) : 0;

        if ((backlink.spamScore ?? 0) >= 60) {
            return { isToxic: true, toxicReason: "provider_spam_score" };
        }

        if (anchor && TOXIC_KEYWORDS.some((keyword) => anchor.includes(keyword))) {
            return { isToxic: true, toxicReason: "toxic_keyword" };
        }

        // Exact-match is only meaningful when it matches the site's declared
        // target keyword. A repeated brand or "click here" anchor is not proof
        // of a toxic link.
        if (
            targetKeyword &&
            anchor === targetKeyword &&
            backlinks.length >= 10 &&
            anchorCount / backlinks.length > 0.30
        ) {
            return { isToxic: true, toxicReason: "exact_match_anchor" };
        }

        if (
            backlink.isDoFollow === true &&
            backlink.domainRating != null &&
            backlink.domainRating < 10 &&
            domainCount > 5
        ) {
            return { isToxic: true, toxicReason: "low_dr_spam" };
        }

        return { isToxic: false, toxicReason: null };
    });
}
