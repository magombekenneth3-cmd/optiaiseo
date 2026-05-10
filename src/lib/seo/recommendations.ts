/**
 * src/lib/seo/recommendations.ts
 *
 * Typed recommendation enrichment engine.
 *
 * Pure functions — no DB calls, no AI calls, no side effects.
 * Input:  raw issue objects as stored in Audit.issueList / AeoReport.checks JSON.
 * Output: EnrichedRecommendation[] — fully typed, sorted, ready to display or email.
 *
 * Adding a new issue type: add a record to ISSUE_META below. Done.
 */


export type EffortLevel  = "quick_win" | "medium" | "complex";
export type ImpactTier   = "critical" | "high" | "medium" | "low";
export type RecommendationCategory = "technical" | "content" | "aeo" | "geo" | "eeat" | "schema";
export type AeoGapType   = "missing_faq_schema" | "answer_too_long" | "no_entity_schema" | "no_speakable" | "topical_gap" | "none";

export interface EnrichedRecommendation {
    /** Original issue ID from audit data, e.g. "schema_faq" */
    checkId:        string;
    /** Human-readable title */
    title:          string;
    /** One-sentence explanation of why this matters */
    why:            string;
    /** Exact action to take — page-specific when pageUrl is provided */
    action:         string;
    /** 0–100 composite priority (impact × confidence × ease) */
    priorityScore:  number;
    /** Effort level for the UI badge */
    effort:         EffortLevel;
    /** Impact tier for sorting and alerting */
    impact:         ImpactTier;
    /** Category for dashboard grouping */
    category:       RecommendationCategory;
    /** Estimated monthly traffic uplift tier */
    trafficUplift:  "significant" | "moderate" | "minor";
    /** AEO-specific gap type — drives content brief generation */
    aeoGap:         AeoGapType;
    /** True if GitHub auto-fix PR can handle this automatically */
    autoFixable:    boolean;
    /** Key for CHECK_TO_FILE in github-autofix.ts */
    autofixCheckId: string | null;
    /** GEO content brief pointer — what to create to get AI citations */
    geoBrief:       GeoBrief | null;
    /** Page URL this applies to — null = applies site-wide */
    pageUrl:        string | null;
    /** Difficulty label for backward compat with email digest */
    difficulty:     "Easy fix" | "Medium effort" | "Complex";
}

export interface GeoBrief {
    /** Recommended page to create or update */
    targetPath:       string;
    /** Ideal answer length in words for AI citation */
    idealAnswerWords: number;
    /** Schema type to add */
    schemaType:       string;
    /** Content format that AI engines prefer for this type */
    format:           "definition" | "faq" | "how-to" | "comparison" | "statistic";
    /** Example first sentence optimised for AI citation */
    starterSentence:  string;
}

// Add new check IDs here to enrich them. Unknown IDs fall through to defaults.

interface IssueMeta {
    title:          string;
    why:            string;
    action:         string;
    impact:         ImpactTier;
    effort:         EffortLevel;
    category:       RecommendationCategory;
    trafficUplift:  EnrichedRecommendation["trafficUplift"];
    aeoGap:         AeoGapType;
    autoFixable:    boolean;
    autofixCheckId: string | null;
    geoBrief:       GeoBrief | null;
}

const ISSUE_META: Record<string, IssueMeta> = {
    schema_faq: {
        title:          "FAQ schema missing",
        why:            "Pages without FAQPage JSON-LD are 3× less likely to be cited by ChatGPT and Perplexity for question-type queries.",
        action:         "Add FAQPage JSON-LD to your <head>. Include 4–6 real visitor questions answered in ≤60 words each.",
        impact:         "critical",
        effort:         "quick_win",
        category:       "schema",
        trafficUplift:  "significant",
        aeoGap:         "missing_faq_schema",
        autoFixable:    true,
        autofixCheckId: "schema_faq",
        geoBrief: {
            targetPath:       "/faq",
            idealAnswerWords: 55,
            schemaType:       "FAQPage",
            format:           "faq",
            starterSentence:  "[Tool/Service] is a [category] that [core value prop in one sentence].",
        },
    },
    schema_organization: {
        title:          "Organization schema missing",
        why:            "Without Organization JSON-LD, AI engines cannot verify who you are — lowering citation trust scores.",
        action:         "Add Organization JSON-LD to your root layout with name, url, logo, and sameAs (LinkedIn, Twitter).",
        impact:         "critical",
        effort:         "quick_win",
        category:       "schema",
        trafficUplift:  "significant",
        aeoGap:         "no_entity_schema",
        autoFixable:    true,
        autofixCheckId: "schema_organization",
        geoBrief: {
            targetPath:       "/about",
            idealAnswerWords: 40,
            schemaType:       "Organization",
            format:           "definition",
            starterSentence:  "[Company] is a [type] based in [location] that [core mission].",
        },
    },
    schema_speakable: {
        title:          "Speakable schema missing",
        why:            "Speakable markup signals which sections of your page AI assistants should read aloud — improving GEO citation quality.",
        action:         "Add Speakable JSON-LD pointing to your key definition and summary sections.",
        impact:         "high",
        effort:         "quick_win",
        category:       "schema",
        trafficUplift:  "moderate",
        aeoGap:         "no_speakable",
        autoFixable:    true,
        autofixCheckId: "schema_speakable",
        geoBrief:       null,
    },
    schema_howto: {
        title:          "HowTo schema missing",
        why:            "HowTo schema increases eligibility for rich results and AI-cited step-by-step answers.",
        action:         "Add HowTo JSON-LD for your primary process/guide page with numbered steps.",
        impact:         "high",
        effort:         "quick_win",
        category:       "schema",
        trafficUplift:  "moderate",
        aeoGap:         "none",
        autoFixable:    true,
        autofixCheckId: "schema_howto",
        geoBrief: {
            targetPath:       "/how-it-works",
            idealAnswerWords: 60,
            schemaType:       "HowTo",
            format:           "how-to",
            starterSentence:  "Here is how to [achieve goal] using [tool/service] in [N] steps:",
        },
    },

    tech_canonical: {
        title:          "Canonical tag missing",
        why:            "Without a canonical tag, Google may index duplicate URLs and split your ranking signals.",
        action:         "Add <link rel='canonical' href='https://yourdomain.com/path'> in every page <head>.",
        impact:         "critical",
        effort:         "quick_win",
        category:       "technical",
        trafficUplift:  "significant",
        aeoGap:         "none",
        autoFixable:    true,
        autofixCheckId: "tech_canonical",
        geoBrief:       null,
    },
    tech_sitemap: {
        title:          "XML sitemap missing or incomplete",
        why:            "Crawlers and AI indexer bots discover content via sitemaps. Missing pages will not be indexed.",
        action:         "Generate a sitemap.xml at /sitemap.xml covering all public pages and submit to Google Search Console.",
        impact:         "high",
        effort:         "quick_win",
        category:       "technical",
        trafficUplift:  "moderate",
        aeoGap:         "none",
        autoFixable:    true,
        autofixCheckId: "tech_sitemap",
        geoBrief:       null,
    },
    missing_h1: {
        title:          "Missing H1 heading",
        why:            "H1 is the strongest on-page keyword signal. Pages without one rank 4–5 positions lower on average.",
        action:         "Add a single <h1> tag at the top of each page containing your primary keyword.",
        impact:         "high",
        effort:         "quick_win",
        category:       "technical",
        trafficUplift:  "significant",
        aeoGap:         "none",
        autoFixable:    false,
        autofixCheckId: null,
        geoBrief:       null,
    },
    slow_lcp: {
        title:          "Slow Largest Contentful Paint (LCP)",
        why:            "LCP > 2.5s is a Core Web Vital failure — directly reduces rankings in Google's page experience signal.",
        action:         "Optimise your hero image (use next/image or <img loading='lazy'>) and defer non-critical JS.",
        impact:         "critical",
        effort:         "medium",
        category:       "technical",
        trafficUplift:  "significant",
        aeoGap:         "none",
        autoFixable:    false,
        autofixCheckId: null,
        geoBrief:       null,
    },

    eeat_about: {
        title:          "About page missing or thin",
        why:            "AI engines use About page content to verify E-E-A-T (Experience, Expertise, Authority, Trust). Thin About pages reduce citation probability.",
        action:         "Create a detailed /about page: team bios, credentials, founding story, and contact details.",
        impact:         "high",
        effort:         "medium",
        category:       "eeat",
        trafficUplift:  "moderate",
        aeoGap:         "none",
        autoFixable:    true,
        autofixCheckId: "eeat_about",
        geoBrief:       null,
    },
    eeat_contact: {
        title:          "Contact page missing",
        why:            "A visible contact page is a CAN-SPAM and GDPR requirement and a strong E-E-A-T trust signal.",
        action:         "Add /contact with email, physical address (required for CAN-SPAM), and a contact form.",
        impact:         "high",
        effort:         "quick_win",
        category:       "eeat",
        trafficUplift:  "minor",
        aeoGap:         "none",
        autoFixable:    true,
        autofixCheckId: "eeat_contact",
        geoBrief:       null,
    },
    eeat_privacy: {
        title:          "Privacy policy missing",
        why:            "Required by GDPR, CCPA, and Google's monetisation policies. Missing privacy pages trigger manual review flags.",
        action:         "Add a /privacy-policy page. Auto-generate a GDPR-compliant template for your jurisdiction.",
        impact:         "critical",
        effort:         "quick_win",
        category:       "eeat",
        trafficUplift:  "minor",
        aeoGap:         "none",
        autoFixable:    true,
        autofixCheckId: "eeat_privacy",
        geoBrief:       null,
    },

    content_faq_section: {
        title:          "No FAQ section on key pages",
        why:            "Pages with embedded FAQ sections (structured Q&A) are cited 2× more often in AI-generated answers.",
        action:         "Add a <section> with <details>/<summary> Q&A to your homepage, pricing, and product pages.",
        impact:         "high",
        effort:         "medium",
        category:       "content",
        trafficUplift:  "significant",
        aeoGap:         "missing_faq_schema",
        autoFixable:    true,
        autofixCheckId: "content_faq_section",
        geoBrief: {
            targetPath:       "/",
            idealAnswerWords: 55,
            schemaType:       "FAQPage",
            format:           "faq",
            starterSentence:  "Frequently asked questions about [product/service]:",
        },
    },
    answer_length: {
        title:          "Page answers are too long for AI citation",
        why:            "AI engines prefer concise answers of 40–60 words. Answers over 150 words are rarely cited verbatim.",
        action:         "Add a TL;DR block (≤60 words) at the top of your key definition and how-to pages.",
        impact:         "high",
        effort:         "medium",
        category:       "geo",
        trafficUplift:  "moderate",
        aeoGap:         "answer_too_long",
        autoFixable:    false,
        autofixCheckId: null,
        geoBrief: {
            targetPath:       "/",
            idealAnswerWords: 55,
            schemaType:       "FAQPage",
            format:           "definition",
            starterSentence:  "[Topic] is [concise definition in 15 words or fewer].",
        },
    },
    topical_gap: {
        title:          "Topical authority gap detected",
        why:            "AI engines will not cite you as an authority on topics you have no published content for.",
        action:         "Create a dedicated page for each detected topic gap. Include a 50-word definition, HowTo or FAQ schema, and internal links.",
        impact:         "high",
        effort:         "complex",
        category:       "geo",
        trafficUplift:  "significant",
        aeoGap:         "topical_gap",
        autoFixable:    false,
        autofixCheckId: null,
        geoBrief: {
            targetPath:       "/[topic-slug]",
            idealAnswerWords: 60,
            schemaType:       "Article",
            format:           "definition",
            starterSentence:  "[Topic] is [definition]. Here is everything you need to know:",
        },
    },
    "content-decay-detector": {
        title:          "Stale content detected",
        why:            "Content older than 12 months without updates sees a median 30% traffic decline as freshness signals decay.",
        action:         "Update top-performing pages with current year, refreshed statistics, and new FAQ entries.",
        impact:         "medium",
        effort:         "medium",
        category:       "content",
        trafficUplift:  "moderate",
        aeoGap:         "none",
        autoFixable:    true,
        autofixCheckId: "content-decay-detector",
        geoBrief:       null,
    },
    "header-tag-strategy": {
        title:          "Suboptimal heading structure",
        why:            "H2/H3 headings are the primary signal for AI engines to understand page subtopics and determine citation scope.",
        action:         "Restructure headings so each major subtopic has its own H2 containing the target keyword phrase.",
        impact:         "medium",
        effort:         "medium",
        category:       "content",
        trafficUplift:  "moderate",
        aeoGap:         "none",
        autoFixable:    true,
        autofixCheckId: "header-tag-strategy",
        geoBrief:       null,
    },
};


const IMPACT_SCORE: Record<ImpactTier, number>   = { critical: 40, high: 30, medium: 20, low: 10 };
const EFFORT_SCORE: Record<EffortLevel, number>   = { quick_win: 30, medium: 20, complex: 10 };
const UPLIFT_SCORE: Record<EnrichedRecommendation["trafficUplift"], number> = {
    significant: 30, moderate: 20, minor: 10,
};

function computePriority(meta: IssueMeta): number {
    return Math.min(100, IMPACT_SCORE[meta.impact] + EFFORT_SCORE[meta.effort] + UPLIFT_SCORE[meta.trafficUplift]);
}

function effortToLabel(effort: EffortLevel): EnrichedRecommendation["difficulty"] {
    if (effort === "quick_win") return "Easy fix";
    if (effort === "medium")    return "Medium effort";
    return "Complex";
}


function defaultMeta(raw: Record<string, unknown>): IssueMeta {
    const sev = String(raw.severity ?? raw.type ?? "warning").toLowerCase();
    const impact: ImpactTier = sev === "error" ? "high" : sev === "warning" ? "medium" : "low";
    return {
        title:          String(raw.title ?? raw.itemId ?? "SEO issue detected"),
        why:            String(raw.detail ?? raw.finding ?? "This issue affects search engine visibility."),
        action:         String(raw.fixSuggestion ?? raw.recommendation ?? "Review and fix this issue."),
        impact,
        effort:         "medium",
        category:       "technical",
        trafficUplift:  impact === "high" ? "moderate" : "minor",
        aeoGap:         "none",
        autoFixable:    false,
        autofixCheckId: null,
        geoBrief:       null,
    };
}


export interface RawIssue {
    id?:              string;
    checkId?:         string;
    itemId?:          string;
    severity?:        string;
    type?:            string;
    title?:           string;
    detail?:          string;
    finding?:         string;
    recommendation?:  string;
    fixSuggestion?:   string;
    passed?:          boolean;
    impact?:          string;
    pageUrl?:         string;
    priorityScore?:   number;
    [key: string]:    unknown;
}

/**
 * Enrich a single raw issue into a typed EnrichedRecommendation.
 * Falls back gracefully for unknown check IDs.
 */
export function enrichIssue(raw: RawIssue, pageUrl?: string): EnrichedRecommendation {
    const checkId = raw.checkId ?? raw.id ?? raw.itemId ?? "unknown";
    const meta    = ISSUE_META[checkId] ?? defaultMeta(raw as Record<string, unknown>);
    const score   = typeof raw.priorityScore === "number" ? raw.priorityScore : computePriority(meta);

    // Personalise action with page URL when available
    const resolvedPageUrl = pageUrl ?? raw.pageUrl ?? null;
    const action = resolvedPageUrl
        ? meta.action.replace("your page", resolvedPageUrl).replace("each page", resolvedPageUrl)
        : meta.action;

    return {
        checkId,
        title:          meta.title,
        why:            meta.why,
        action,
        priorityScore:  Math.min(100, score),
        effort:         meta.effort,
        impact:         meta.impact,
        category:       meta.category,
        trafficUplift:  meta.trafficUplift,
        aeoGap:         meta.aeoGap,
        autoFixable:    meta.autoFixable,
        autofixCheckId: meta.autofixCheckId,
        geoBrief:       meta.geoBrief,
        pageUrl:        resolvedPageUrl,
        difficulty:     effortToLabel(meta.effort),
    };
}

/**
 * Parse a raw issueList JSON blob (as stored in Audit.issueList or AeoReport.checks)
 * and return sorted, enriched recommendations ready for display or email.
 *
 * @param issueList   Raw JSON from database
 * @param limit       Maximum number to return (default 10)
 * @param minImpact   Filter to critical/high/medium (default: all)
 */
export function extractEnrichedRecommendations(
    issueList: unknown,
    limit = 10,
    minImpact: ImpactTier = "low",
): EnrichedRecommendation[] {
    const IMPACT_ORDER: ImpactTier[] = ["critical", "high", "medium", "low"];
    const minIdx = IMPACT_ORDER.indexOf(minImpact);

    let raws: RawIssue[] = [];

    if (Array.isArray(issueList)) {
        raws = issueList as RawIssue[];
    } else if (issueList && typeof issueList === "object") {
        const obj = issueList as Record<string, unknown>;
        if (Array.isArray(obj.recommendations)) raws = obj.recommendations as RawIssue[];
        else if (Array.isArray(obj.issues))          raws = obj.issues as RawIssue[];
        else if (Array.isArray(obj.checks))          raws = obj.checks as RawIssue[];
    }

    return raws
        .filter((r) => {
            // Include failing checks and error/warning severity items
            if (r.passed === false) return true;
            const sev = String(r.severity ?? r.type ?? "").toLowerCase();
            return sev === "error" || sev === "warning";
        })
        .map((raw) => enrichIssue(raw))
        .filter((rec) => {
            const idx = IMPACT_ORDER.indexOf(rec.impact);
            return idx <= minIdx;
        })
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, limit);
}

/**
 * Returns only the auto-fixable recommendations — used to decide
 * whether to trigger a GitHub PR via the autofix Inngest job.
 */
export function getAutoFixableIssues(issueList: unknown): EnrichedRecommendation[] {
    return extractEnrichedRecommendations(issueList, 20, "high")
        .filter((r) => r.autoFixable && r.autofixCheckId !== null);
}

/**
 * Returns only AEO/GEO gaps — used by the citation-gap and GEO brief jobs.
 */
export function getAeoGaps(issueList: unknown): EnrichedRecommendation[] {
    return extractEnrichedRecommendations(issueList, 20, "medium")
        .filter((r) => r.aeoGap !== "none" || r.category === "aeo" || r.category === "geo");
}

/**
 * Returns the GEO content briefs for issues that have them.
 * Deduplicated by targetPath — highest priority brief wins.
 */
export function getGeoBriefs(issueList: unknown): GeoBrief[] {
    const seen = new Set<string>();
    return extractEnrichedRecommendations(issueList, 20, "medium")
        .filter((r) => r.geoBrief !== null)
        .reduce<GeoBrief[]>((acc, r) => {
            if (!seen.has(r.geoBrief!.targetPath)) {
                seen.add(r.geoBrief!.targetPath);
                acc.push(r.geoBrief!);
            }
            return acc;
        }, []);
}
