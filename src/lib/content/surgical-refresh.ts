import { formatRecommendedActionLabel, formatUrlPathForDisplay } from "@/lib/gsc/topic-cluster";
import type { AuthorProfile } from "@/lib/blog";

export type SurgicalExecutionMode = "refresh" | "new_article";

export interface SelectedTopicContext {
    keyword: string;
    actionType?: "CREATE_PAGE" | "UPDATE_PAGE";
    existingPageUrl?: string | null;
    recommendedAction?: string;
    clusterQueries?: string[];
    intent?: string;
    position?: number;
    impressions?: number;
    executionMode: SurgicalExecutionMode;
}

export interface TopicSuggestionLike {
    keyword: string;
    actionType?: "CREATE_PAGE" | "UPDATE_PAGE";
    existingPageUrl?: string | null;
    recommendedAction?: string;
    clusterQueries?: string[];
    intent?: string;
    position?: number;
    impressions?: number;
    gscImpressions90d?: number;
}

/**
 * Build structured `SelectedTopicContext` from a matched opportunity suggestion, defaulting
 * `UPDATE_PAGE` opportunities with an existing URL to `"refresh"` mode to prevent cannibalization.
 */
export function buildSelectedTopicContext(
    keyword: string,
    suggestion?: TopicSuggestionLike | null,
    executionModeOverride?: SurgicalExecutionMode
): SelectedTopicContext | undefined {
    const cleanKeyword = keyword.trim();
    if (!suggestion) return undefined;

    const isUpdatePage =
        suggestion.actionType === "UPDATE_PAGE" && Boolean(suggestion.existingPageUrl);

    return {
        keyword: cleanKeyword || suggestion.keyword,
        actionType: suggestion.actionType ?? "CREATE_PAGE",
        existingPageUrl: suggestion.existingPageUrl ?? null,
        recommendedAction: suggestion.recommendedAction,
        clusterQueries: suggestion.clusterQueries ?? [],
        intent: suggestion.intent,
        position: suggestion.position,
        impressions: suggestion.gscImpressions90d ?? suggestion.impressions,
        executionMode: isUpdatePage ? (executionModeOverride ?? "refresh") : "new_article",
    };
}

export interface RefreshChangeSummary {
    targetUrl: string;
    targetPath: string;
    preservedSlug: string;
    recommendedAction?: string;
    originalWordCount: number;
    refreshedWordCount: number;
    wordCountDelta: number;
    originalHeadings: string[];
    refreshedHeadings: string[];
    retainedHeadings: string[];
    addedHeadings: string[];
    removedHeadings: string[];
    clusterQueriesRequested: string[];
    clusterQueriesCovered: string[];
    clusterQueriesMissingBefore: string[];
    clusterQueriesAdded: string[];
}

export interface StoredRefreshMetadata {
    mode: "CONTENT_REFRESH";
    sourceOperation: "keyword_gap" | "content_decay";
    targetUrl: string;
    preservedSlug: string;
    recommendedAction?: string;
    clusterQueries: string[];
    originalExtractedContent: string;
    refreshSummary: RefreshChangeSummary;
}

/** Normalize a domain or URL string to a lowercase bare hostname without `www.`. */
export function normalizeHostname(input: string): string {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return "";

    try {
        const parsed = trimmed.includes("://")
            ? new URL(trimmed)
            : new URL(`https://${trimmed}`);
        return parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
    } catch {
        return trimmed
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .split("/")[0]
            .split(":")[0]
            .replace(/\.$/, "");
    }
}

/**
 * Ensure the scraped target URL uses HTTP(S), carries no credentials, and belongs
 * to the authenticated user's Site domain (exact apex or subdomain match).
 */
export function isTargetUrlOnSiteDomain(targetUrl: string, siteDomain: string): boolean {
    const siteHost = normalizeHostname(siteDomain);
    if (!siteHost) return false;

    let parsed: URL;
    try {
        parsed = new URL(targetUrl.trim());
    } catch {
        return false;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
    }
    if (parsed.username || parsed.password) {
        return false;
    }

    const targetHost = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return targetHost === siteHost || targetHost.endsWith(`.${siteHost}`);
}

/**
 * Extract or preserve the canonical URL slug when refreshing an existing page so
 * the updated draft maps back to the same path instead of creating a competing URL.
 */
export function derivePreservedSlug(
    targetUrl: string,
    existingBlogSlug?: string | null,
    fallbackTitle?: string
): string {
    const explicitSlug = existingBlogSlug?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (explicitSlug) {
        return explicitSlug.slice(0, 100);
    }

    try {
        const parsed = new URL(targetUrl);
        const segments = parsed.pathname
            .split("/")
            .map((s) => s.trim())
            .filter(Boolean);
        const rawSegment = segments.at(-1) ?? "";
        const withoutExt = rawSegment.replace(/\.(html?|php|aspx?|md)$/i, "");
        const slugged = withoutExt
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        if (slugged) {
            return slugged.slice(0, 100);
        }
        // Root path "/" should map deterministically to the fallback title or "home"
        if (segments.length === 0 && !fallbackTitle) {
            return "home";
        }
    } catch {
        // Fall through to title slugification
    }

    const fromTitle = (fallbackTitle ?? "refreshed-page")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return (fromTitle || "refreshed-page").slice(0, 100);
}

function stripTagsAndEntities(text: string): string {
    return text
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeTextForMatch(text: string): string {
    return stripTagsAndEntities(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function countWordsInMixedContent(text: string): number {
    const cleaned = stripTagsAndEntities(text)
        .replace(/^[#>*\-+`\s]+/gm, " ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[*_`~]/g, " ")
        .trim();
    if (!cleaned) return 0;
    return cleaned.split(/\s+/).filter(Boolean).length;
}

/**
 * Extract ordered headings and plain word count from markdown, extracted page outlines
 * (`H1: ...`, `H2: ...`, `H3: ...`), or rendered HTML.
 */
export function extractHeadingsAndWords(content: string): {
    headings: string[];
    wordCount: number;
} {
    const headings: string[] = [];
    const seen = new Set<string>();

    const pushHeading = (raw: string) => {
        const clean = stripTagsAndEntities(raw).replace(/^#+\s*/, "").trim();
        const key = clean.toLowerCase();
        if (!clean || clean.length < 2 || seen.has(key)) return;
        seen.add(key);
        headings.push(clean);
    };

    const htmlHeadingMatches = content.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi);
    for (const match of htmlHeadingMatches) {
        pushHeading(match[1]);
    }

    for (const line of content.split(/\r?\n/)) {
        const mdMatch = line.match(/^\s{0,3}#{1,4}\s+(.+)$/);
        if (mdMatch) {
            pushHeading(mdMatch[1]);
            continue;
        }
        const extractedMatch = line.match(/^\s*H[1-4]:\s+(.+)$/i);
        if (extractedMatch) {
            pushHeading(extractedMatch[1]);
        }
    }

    return {
        headings,
        wordCount: countWordsInMixedContent(content),
    };
}

function containsNormalizedPhrase(haystack: string, needle: string): boolean {
    const normalizedNeedle = normalizeTextForMatch(needle);
    if (!normalizedNeedle) return false;
    if (haystack.includes(normalizedNeedle)) return true;

    const words = normalizedNeedle.split(" ").filter((w) => w.length >= 3);
    if (words.length <= 1) return false;

    // Require all query terms to co-occur within a 120-char local phrase window
    // so scattered words across distant sections don't register as covered.
    const anchor = words[0];
    let searchFrom = 0;
    while (searchFrom < haystack.length) {
        const idx = haystack.indexOf(anchor, searchFrom);
        if (idx === -1) return false;
        const windowStart = Math.max(0, idx - 60);
        const windowEnd = Math.min(haystack.length, idx + anchor.length + 60);
        const snippet = haystack.slice(windowStart, windowEnd);
        if (words.every((w) => snippet.includes(w))) {
            return true;
        }
        searchFrom = idx + anchor.length;
    }
    return false;
}

/**
 * Compute a structured section- and query-level diff summary comparing the scraped
 * live page against the refreshed draft.
 */
export function computeSurgicalRefreshSummary(params: {
    targetUrl: string;
    preservedSlug: string;
    originalContent: string;
    refreshedContent: string;
    clusterQueries?: string[];
    recommendedAction?: string;
}): RefreshChangeSummary {
    const original = extractHeadingsAndWords(params.originalContent);
    const refreshed = extractHeadingsAndWords(params.refreshedContent);

    const origHeadingKeys = new Set(original.headings.map((h) => normalizeTextForMatch(h)));
    const newHeadingKeys = new Set(refreshed.headings.map((h) => normalizeTextForMatch(h)));

    const retainedHeadings = refreshed.headings.filter((h) => origHeadingKeys.has(normalizeTextForMatch(h)));
    const addedHeadings = refreshed.headings.filter((h) => !origHeadingKeys.has(normalizeTextForMatch(h)));
    const removedHeadings = original.headings.filter((h) => !newHeadingKeys.has(normalizeTextForMatch(h)));

    const originalNormalizedBody = normalizeTextForMatch(params.originalContent);
    const refreshedNormalizedBody = normalizeTextForMatch(params.refreshedContent);

    const uniqueQueries = Array.from(
        new Set((params.clusterQueries ?? []).map((q) => q.trim()).filter(Boolean))
    );
    const clusterQueriesMissingBefore = uniqueQueries.filter(
        (q) => !containsNormalizedPhrase(originalNormalizedBody, q)
    );
    const clusterQueriesCovered = uniqueQueries.filter((q) =>
        containsNormalizedPhrase(refreshedNormalizedBody, q)
    );
    const clusterQueriesAdded = clusterQueriesMissingBefore.filter((q) =>
        containsNormalizedPhrase(refreshedNormalizedBody, q)
    );

    return {
        targetUrl: params.targetUrl,
        targetPath: formatUrlPathForDisplay(params.targetUrl) ?? "/",
        preservedSlug: params.preservedSlug,
        recommendedAction: params.recommendedAction,
        originalWordCount: original.wordCount,
        refreshedWordCount: refreshed.wordCount,
        wordCountDelta: refreshed.wordCount - original.wordCount,
        originalHeadings: original.headings,
        refreshedHeadings: refreshed.headings,
        retainedHeadings,
        addedHeadings,
        removedHeadings,
        clusterQueriesRequested: uniqueQueries,
        clusterQueriesCovered,
        clusterQueriesMissingBefore,
        clusterQueriesAdded,
    };
}

const RECOMMENDED_ACTION_GUIDANCE: Record<string, string> = {
    IMPROVE_SEARCH_INTENT:
        "Realign opening framing, section hierarchy, and examples to match dominant searcher intent while retaining accurate existing sections.",
    REFRESH_CONTENT:
        "Update outdated facts, year references, workflows, and stale examples in place without discarding sound core explanations.",
    OPTIMIZE_CONTENT_DEPTH:
        "Expand thin sections with concrete implementation detail, trade-offs, edge cases, and unanswered sub-questions from the query cluster.",
    CONSOLIDATE_CONTENT:
        "Strengthen this canonical page so it comprehensively resolves overlapping sub-queries in the cluster instead of splitting focus.",
    OPTIMIZE_TITLE:
        "Sharpen the H1 headline, meta description, and opening lead to maximize SERP CTR and query relevance.",
    ADD_INTERNAL_LINKS:
        "Preserve page structure while reinforcing topical context and clear descriptive anchor hooks for related cluster pages.",
};

/**
 * Build the surgical update prompt instructing the model to preserve sound structure
 * and canonical target alignment while executing the diagnosed page action and cluster gaps.
 */
export function buildSurgicalRefreshPrompt(params: {
    keyword: string;
    targetUrl: string;
    preservedSlug: string;
    siteDomain: string;
    recommendedAction?: string;
    clusterQueries?: string[];
    extractedOriginal: string;
    serpContextSummary: string;
    author?: AuthorProfile;
    currentYear: number;
}): string {
    const actionCode = params.recommendedAction?.toUpperCase() ?? "REFRESH_CONTENT";
    const actionLabel = formatRecommendedActionLabel(actionCode, "UPDATE_PAGE");
    const actionGuidance =
        RECOMMENDED_ACTION_GUIDANCE[actionCode] ??
        RECOMMENDED_ACTION_GUIDANCE.REFRESH_CONTENT;

    const clusterList = (params.clusterQueries ?? []).filter(Boolean);
    const authorLines = params.author
        ? [
              `Author Name: ${params.author.name}`,
              params.author.role ? `Role: ${params.author.role}` : null,
              params.author.bio ? `Bio: ${params.author.bio}` : null,
              params.author.realExperience ? `First-hand experience: ${params.author.realExperience}` : null,
              params.author.realNumbers ? `Verified numbers/metrics: ${params.author.realNumbers}` : null,
              params.author.localContext ? `Geographic/market context: ${params.author.localContext}` : null,
          ]
              .filter(Boolean)
              .join("\n")
        : "";

    return `You are performing a SURGICAL SEO & AI-Search CONTENT REFRESH on an EXISTING ranking page — NOT inventing an unrelated new article.

TARGET CANONICAL PAGE: ${params.targetUrl}
PRESERVED SLUG (MUST REMAIN IDENTICAL): ${params.preservedSlug}
SITE DOMAIN: ${params.siteDomain}
PRIMARY TARGET QUERY: "${params.keyword}"
DIAGNOSED ACTION (${actionCode} — ${actionLabel}):
${actionGuidance}

${clusterList.length > 0 ? `CLUSTER QUERIES TO INCORPORATE NATURALLY:\n${clusterList.map((q) => `- ${q}`).join("\n")}\n` : ""}
${authorLines ? `AUTHOR E-E-A-T GROUNDING (weave authentically where helpful; NEVER fabricate unstated statistics):\n${authorLines}\n` : ""}
--- EXISTING PAGE EXTRACT ---
${params.extractedOriginal}
--- END EXISTING PAGE EXTRACT ---

${params.serpContextSummary}

SURGICAL REFRESH RULES (${params.currentYear}):
1. PRESERVE CANONICAL TARGETING & SOUND SECTIONS: Keep working H2/H3 section topics and core factual claims that still serve searchers cleanly. Do NOT rename the URL slug; set \`slug\` to "${params.preservedSlug}".
2. SURGICAL REMEDIATION: Upgrade weak intros, stale ${params.currentYear - 2}/${params.currentYear - 1} references, missing comparisons, thin steps, and unanswered questions directly tied to "${actionLabel}" and the cluster queries.
3. ZERO INVENTED DATA: If the author profile provided verified metrics, integrate them accurately. Never invent customer percentages, fake studies, or fabricated citations.
4. AI CITATION & QUICK ANSWER: Provide a concise standalone 2-3 sentence \`quickAnswer\`, clear Markdown sections (\`content\`), up to 4 concise FAQs targeting uncovered cluster questions, and natural integration of missing cluster phrases.
5. OUTPUT: Return valid JSON matching the requested schema, with \`slug\` set to "${params.preservedSlug}".`;
}
