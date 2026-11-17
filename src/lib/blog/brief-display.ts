/**
 * User-facing formatting helpers for `SerpCompetitiveBrief` inspection surfaces.
 * Keeps raw internal prompt instructions, clipped dates, unreadable enum keys,
 * and unlabelled `[Source]` chains out of the review sidebar.
 */

const FEATURE_LABELS: Record<string, string> = {
    featured_snippet: "Featured Snippet",
    people_also_ask: "People Also Ask",
    related_searches: "Related Queries",
    video_result: "Video Results",
    interactive_tool_result: "Interactive Tool",
};

const OPPORTUNITY_TYPE_LABELS: Record<string, string> = {
    reader_need: "Reader Question",
    coverage_requirement: "Core Topic",
    inferred_coverage_gap: "Potential Gap",
    freshness_check: "Freshness Check",
    decision_criteria: "Decision Criterion",
    research_task: "Research Task",
};

const PAGE_TYPE_LABELS: Record<string, string> = {
    interactive_tool: "Tool",
    product_page: "Product Page",
    listicle: "Listicle",
    comparison: "Comparison",
    tutorial: "Guide",
    article: "Article",
    forum: "Forum",
    video: "Video",
    news: "News",
    other: "Page",
};

const SCRAPE_STATUS_LABELS: Record<string, string> = {
    ANALYZED: "Analysed",
    SNIPPET_ONLY: "Snippet Only",
    FAILED: "Blocked / Failed",
    UNSCRAPPABLE: "Unscrappable",
};

const ACTION_LABELS: Record<string, string> = {
    UPDATE_EXISTING: "Update Existing Page",
    SUPPORTING_ARTICLE: "Supporting Article",
    CREATE_PILLAR: "New Pillar Article",
    REQUEST_REVIEW: "Needs Human Review",
};

const VERIFICATION_LABELS: Record<string, string> = {
    observed: "Observed",
    inferred: "Inferred",
    requires_research: "Needs Research",
};

/**
 * Converts a URL into a crisp domain chip label (e.g. `https://www.zapier.com/blog/...` -> `zapier.com`).
 */
export function formatSourceDomainLabel(rawUrl: string): string {
    try {
        const host = new URL(rawUrl).hostname.replace(/^www\./i, "").trim();
        return host || rawUrl;
    } catch {
        const stripped = rawUrl.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0]?.trim();
        return stripped || rawUrl;
    }
}

/**
 * Formats SERP page published dates cleanly and omits clipped yearless strings (e.g. `"August 5,"`).
 */
export function formatPublishedDateLabel(rawDate: string | null | undefined): string | null {
    if (!rawDate) return null;
    const cleaned = rawDate.replace(/[,\s]+$/g, "").trim();
    if (!cleaned) return null;

    // Yearless clipped dates like "August 5," are ambiguous across years — omit them cleanly.
    if (!/\b(?:19|20)\d{2}\b/.test(cleaned)) {
        return null;
    }

    const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]) - 1;
        const day = Number(isoMatch[3]);
        const dt = new Date(Date.UTC(year, month, day));
        if (!Number.isNaN(dt.getTime())) {
            return dt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
            });
        }
    }

    const parsed = Date.parse(cleaned);
    if (!Number.isNaN(parsed)) {
        const dt = new Date(parsed);
        const hasTimeOrZone = /\d{2}:\d{2}|(?:gmt|utc|[zZ]|[+-]\d{2}:?\d{2})/.test(cleaned);
        const utcDate = hasTimeOrZone
            ? dt
            : new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
        return utcDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
        });
    }

    return cleaned;
}

export function formatBriefBadgeLabel(
    kind: "feature" | "opportunity" | "pageType" | "scrapeStatus" | "action" | "verification",
    raw: string,
): string {
    const tables: Record<typeof kind, Record<string, string>> = {
        feature: FEATURE_LABELS,
        opportunity: OPPORTUNITY_TYPE_LABELS,
        pageType: PAGE_TYPE_LABELS,
        scrapeStatus: SCRAPE_STATUS_LABELS,
        action: ACTION_LABELS,
        verification: VERIFICATION_LABELS,
    };
    return tables[kind][raw] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const INTERNAL_PROMPT_PATTERNS: RegExp[] = [
    /avoid implying the ranking pages failed to answer unless accessible page text supports that claim\.?/gi,
    /give a direct,\s*evidence-supported answer,\s*explain caveats,?/gi,
    /treat this as a hypothesis until full-page evidence or independent research confirms the need\.?/gi,
    /rather than repeating competitor wording\.?/gi,
];

/**
 * Strips raw internal LLM writer directives from legacy persisted `additionalValue` strings
 * so the inspector shows concise editor context instead of prompt engineering boilerplate.
 */
export function formatOpportunityGuidanceForUi(
    rawText: string | null | undefined,
    opportunityType?: string,
    supportingUrlCount = 0,
): string {
    const trimmed = (rawText ?? "").trim();
    const isInternalDirective = INTERNAL_PROMPT_PATTERNS.some((re) => {
        re.lastIndex = 0;
        return re.test(trimmed);
    });

    if (!trimmed || isInternalDirective) {
        if (opportunityType === "inferred_coverage_gap") {
            return "Candidate topic from SERP signals not prominently matched in sampled excerpts.";
        }
        if (opportunityType === "decision_criteria") {
            return supportingUrlCount > 0
                ? `Recurring evaluation criterion across ${supportingUrlCount} analysed SERP result${supportingUrlCount === 1 ? "" : "s"}.`
                : "Recurring evaluation criterion in sampled SERP results.";
        }
        return supportingUrlCount > 0
            ? `Aligned with ${supportingUrlCount} ranking result${supportingUrlCount === 1 ? "" : "s"} in the live SERP.`
            : "Surfaced directly by live SERP People Also Ask or related queries.";
    }

    return trimmed;
}

