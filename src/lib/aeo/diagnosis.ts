/**
 * AEO (Answer Engine Optimization) Diagnosis Engine
 * 
 * Analyses brand mention records from AEO tracking queries and produces a
 * structured diagnosis with a score, patterns, competitor analysis, and a
 * prioritised action plan with concrete how-to steps.
 */

export interface MentionRecord {
    keyword: string;
    mentioned: boolean;
    competitorsMentioned: string[];
    queriedAt: Date;
}

export interface ActionItem {
    priority: "Critical" | "High" | "Medium";
    category: "Entity" | "Schema" | "Content" | "Citations" | "Technical" | "GEO" | "AIO";
    title: string;
    effort: "30 minutes" | "2 hours" | "1 day" | "1 week";
    what: string;
    why: string;
    howSteps: string[];
    estimatedImpact: string;
}

export interface AeoDiagnosis {
    score: number;           // 0–100
    grade: "Critical" | "Poor" | "Fair" | "Good" | "Excellent";
    primaryProblem: string;
    explanation: string;
    competitorCounts: Record<string, number>;
    patterns: {
        brandedQueriesFailing: boolean;
        genericQueriesFailing: boolean;
        irrelevantResultsOnBranded: boolean;
        topCompetitors: string[];  // competitors appearing 2+ times
    };
    actionPlan: ActionItem[];
    pendingActionCount: number;
}

/** Derives a grade label from a numeric score */
function scoreToGrade(score: number): AeoDiagnosis["grade"] {
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    if (score >= 20) return "Poor";
    return "Critical";
}

function detectIrrelevantResults(record: MentionRecord, unrelatedSignals: string[] = []): boolean {
    if (!record.competitorsMentioned.length || !unrelatedSignals.length) return false;
    const mentionedLower = record.competitorsMentioned.map(c => c.toLowerCase());
    return mentionedLower.some(c =>
        unrelatedSignals.some(signal => c.includes(signal.toLowerCase()))
    );
}

function isBrandedQuery(keyword: string, brandHints: string[]): boolean {
    const kw = keyword.toLowerCase();
    return brandHints.some(hint => kw.includes(hint.toLowerCase()));
}

/** Build the action plan based on which patterns fired */
function buildActionPlan(patterns: AeoDiagnosis["patterns"], score: number): ActionItem[] {
    const items: ActionItem[] = [];

    // Always include the foundational items for low scores
    if (score < 40 || patterns.irrelevantResultsOnBranded) {
        items.push({
            priority: "Critical",
            category: "Entity",
            title: "Add Organization JSON-LD schema to every page",
            effort: "2 hours",
            what: "Add complete Organization structured data markup to every page on your site.",
            why: "Organization structured data provides a machine-readable description of your entity — including your industry, geography, and official profiles. Without structured entity data, AI systems rely on less reliable signals and may associate your brand with incorrect categories.",
            howSteps: [
                "Create a script tag with type=\"application/ld+json\" in your site's <head>",
                'Include: "@type": "Organization", "name": "[Brand]", "description": "[plain language description]"',
                'Add "url", "areaServed": {"@type": "Country", "name": "[Country]"}',
                'Add "serviceType": "[your service type, e.g. Internet Service Provider]"',
                'Add "sameAs": ["[Twitter URL]", "[LinkedIn URL]", "[Facebook URL]", "[Wikipedia URL if exists]"]',
                "Deploy the schema — validate at schema.org/SchemaApp or Google Rich Results Test",
                "Verify indexed in Google Search Console > Enhancements > Structured Data",
            ],
            estimatedImpact: "High — structured entity data helps AI knowledge graphs associate your brand with the correct industry. Monitor subsequent crawls and citation observations after deployment.",
        });

        items.push({
            priority: "Critical",
            category: "Citations",
            title: "Get cited on authoritative regional tech and business publications",
            effort: "1 week",
            what: "Secure brand mentions with backlinks on African tech publications and ISP directories.",
            why: "AI systems learn brand-industry associations from citation patterns across trusted web sources. External citations from authoritative sources can strengthen your brand's presence in the sources AI systems draw on.",
            howSteps: [
                "Submit a press release or pitch to techcabal.com — Africa's leading tech publication",
                "Submit to disrupt-africa.com — startup and tech news for African markets",
                "Submit to itnewsafrica.com — IT news for African businesses",
                "Register in the Uganda Communications Commission directory at ucc.co.ug",
                "Add a Crunchbase profile with full company info and service description",
                "Submit to Cable.co.uk's global ISP listing database",
                "Ensure each listing uses identical brand name, address, and phone (NAP consistency)",
            ],
            estimatedImpact: "Potentially high — external citations on authoritative sources can strengthen brand-industry associations in AI training data. Results depend on publication reach and indexing timelines.",
        });
    }

    if (patterns.genericQueriesFailing || score < 60) {
        items.push({
            priority: "High",
            category: "Content",
            title: "Create dedicated landing pages for each failed query phrase",
            effort: "1 day",
            what: "Build a dedicated optimized page for each specific query phrase that failed to cite your brand.",
            why: "AI systems extract answers from pages structured to directly address the searched question. A page whose content is focused on a specific query phrase is better positioned to answer that question than a generic homepage.",
            howSteps: [
                "Identify the exact query phrases from your AEO tracking that showed 0% mention rate",
                "Create one page per failing query (e.g. /fiber-internet-uganda, /cheapest-internet-uganda)",
                "Put the exact query phrase in the H1, first 100 words, meta description, and title tag",
                "Add FAQPage schema with 5 questions — include: 'What is [brand]?', costs, speeds, coverage, contact",
                "Add LocalBusiness or ISP-specific schema with areaServed and serviceType",
                "Target 800–1,200 words with direct, factual answers — no marketing fluff",
                "Internally link these pages from the homepage and main navigation",
            ],
            estimatedImpact: "High — directly targets the query phrases where your brand is not appearing. Monitor citation observations after publishing.",
        });
    }

    items.push({
        priority: "High",
        category: "Schema",
        title: "Add FAQPage schema to homepage and main service pages",
        effort: "2 hours",
        what: "Add FAQPage structured data with 5 specific questions and direct answers on your key pages.",
        why: "FAQPage schema can help search and AI systems identify Q&A content on qualifying pages. Pages with explicit question-and-answer markup are structured in a format that can be more readily extracted for answer-type queries.",
        howSteps: [
            'Add a script[type="application/ld+json"] block to homepage and service pages',
            'Use "@type": "FAQPage" with "mainEntity" array of Question/Answer pairs',
            'Required questions: "What is [Brand]?", "How much does [Brand] internet cost?", "What speeds does [Brand] offer?", "What areas does [Brand] cover?", "How do I contact [Brand]?"',
            "Each answer must be 1–2 sentences, factual, and contain the brand name",
            "Validate at Google Rich Results Test before publishing",
            "Check Google Search Console for FAQ eligibility after 2 weeks",
        ],
        estimatedImpact: "Medium-high — FAQ structured data can help search and AI systems identify question-and-answer content on qualifying pages. Monitor indexing and subsequent citation observations after deployment.",
    });

    items.push({
        priority: "High",
        category: "Entity",
        title: "Create or claim a Wikipedia and Wikidata entry",
        effort: "1 day",
        what: "Get the brand listed on Wikipedia and Wikidata with full entity information.",
        why: "Wikipedia is a widely used reference source for major AI training datasets. A Wikipedia entry with appropriate sourcing and notability can strengthen an entity's presence in sources AI systems draw on.",
        howSteps: [
            "Search Wikipedia to verify no existing article covers the brand",
            "If none exists, draft an article covering: founding year, ownership, headquarters, service areas, notable facts",
            "Use Wikipedia's article wizard — ensure the topic meets notability guidelines (citations required)",
            "Add founding date, country of operation, service type, and parent company if applicable",
            "Create a corresponding Wikidata item and link it to the Wikipedia article",
            "Add the Wikipedia URL to the sameAs array in your Organization JSON-LD schema",
            "Note: Wikipedia articles must be neutral and cited — never promotional",
        ],
        estimatedImpact: "Potentially high for branded queries — Wikipedia is a widely used reference source. Notability criteria apply; this is not appropriate for all brands.",
    });

    items.push({
        priority: "Medium",
        category: "Technical",
        title: "Add an llms.txt file to the site root",
        effort: "30 minutes",
        what: "Create a plain text file at the domain root that tells AI crawlers what your site is about.",
        why: "llms.txt is an emerging convention (similar to robots.txt) that provides machine-readable site context to AI crawlers. It can help AI systems ingest brand information during crawling.",
        howSteps: [
            "Create a file at /llms.txt (or update the existing llms-txt route if it exists)",
            "Start with: # [Brand Name]",
            "> [Single sentence brand summary including industry and geography]",
            "Add a ## Services section listing each service with a plain description",
            "Add a ## Coverage section listing coverage areas",
            "Add a ## Contact section with website URL",
            "Test by visiting yourdomain.com/llms.txt — should return plain text",
        ],
        estimatedImpact: "Medium — can help AI crawlers understand site content at index time. Low effort, useful as a supplementary signal.",
    });

    items.push({
        priority: "Medium",
        category: "Citations",
        title: "Standardize NAP (Name, Address, Phone) across all directories",
        effort: "2 hours",
        what: "Ensure Name, Address, and Phone are exactly identical across every online presence.",
        why: "Inconsistent entity data (e.g. 'Ltd' vs 'Limited' vs no suffix) can reduce AI entity confidence. When data varies across sources, AI systems may treat different representations as separate entities, reducing citation cohesion.",
        howSteps: [
            "Decide on one exact canonical brand name format and never deviate from it",
            "Update Google Business Profile with the canonical NAP",
            "Check and update: Facebook Business, LinkedIn Company, Twitter/X bio, Instagram bio",
            "Update all directory listings to use identical NAP",
            "Update the website footer to match exactly",
            "Use a NAP consistency checker tool (BrightLocal or Moz Local) to find remaining inconsistencies",
            "Document the canonical NAP in an internal brand style guide",
        ],
        estimatedImpact: "Medium — consistent entity data across sources reduces the likelihood of AI systems treating different representations as separate entities. Cumulative effect over time.",
    });

    items.push({
        priority: "High",
        category: "GEO",
        title: "Add transparent pricing and clear use-case pages",
        effort: "1 day",
        what: "Create a /pricing page and a 'Who it's for' section on your homepage.",
        why: "Clear pricing, use-case descriptions, and reviews help AI systems evaluate product fit when generating recommendations in commercial queries. Vague positioning may result in AI choosing more clearly-defined alternatives.",
        howSteps: [
            "Create /pricing with 2–3 named tiers, clear per-tier features, and a free trial or demo CTA",
            "Add a 'Who it's for' or 'Perfect for...' section to your homepage",
            "Add AggregateRating schema with real customer star ratings",
            "Add a '[Your Brand] vs [Competitor]' comparison page targeting a head-to-head keyword",
            "Publish 1–2 case studies with specific numbers (e.g. '30% more leads', '$5k/mo saved')",
        ],
        estimatedImpact: "Potentially high — clear pricing, use-case descriptions, and social proof help AI systems evaluate product/service fit when recommending in commercial queries.",
    });

    items.push({
        priority: "High",
        category: "AIO",
        title: "Fix your brand footprint so AI understands your business",
        effort: "2 hours",
        what: "Enrich your About page, add sameAs schema, and create an llms.txt file.",
        why: "AIO is about getting your brand understood by AI. If AI knowledge graphs lack reliable data about you (founding year, industry, verified profiles), AI may not reference your brand when it should be relevant.",
        howSteps: [
            "Expand /about to include: founding year, team size, location, and mission — at least 400 words",
            "Add sameAs array to your Organization JSON-LD with links to LinkedIn, Twitter/X, Crunchbase, and any Wikipedia entry",
            "Create /llms.txt: start with # Brand Name, then a one-paragraph description and ## Services list",
            "Link all social profiles from your site footer with rel=me attributes",
            "Ensure Name/Address/Phone is identical in footer, Contact page, Google Business Profile, and schema",
        ],
        estimatedImpact: "Potentially high — enriching entity signals (About page, sameAs, structured identity) can improve how AI knowledge graphs associate your brand. Monitor subsequent citation observations after publishing.",
    });

    // Sort: Critical first, then High, then Medium
    return items.sort((a, b) => {
        const order = { Critical: 0, High: 1, Medium: 2 };
        return order[a.priority] - order[b.priority];
    });
}

/**
 * @param records          - AEO mention records to analyse
 * @param unrelatedSignals - Domain fragments that signal irrelevant results on branded queries
 * @param brandNames       - Explicit brand name tokens (e.g. ["OptiAISEO", "optiaiseo"]).
 *                           When provided, replaces the heuristic keyword-length approach
 *                           for classifying queries as branded vs generic.
 */
export function diagnoseAeoData(
  records: MentionRecord[],
  unrelatedSignals: string[] = [],
  brandNames: string[] = [],
): AeoDiagnosis {
    if (records.length === 0) {
        return {
            score: 0,
            grade: "Critical",
            primaryProblem: "No AEO tracking data yet",
            explanation: "No keyword tracking records found. Add keywords to track and run AEO checks to generate a diagnosis.",
            competitorCounts: {},
            patterns: {
                brandedQueriesFailing: false,
                genericQueriesFailing: false,
                irrelevantResultsOnBranded: false,
                topCompetitors: [],
            },
            actionPlan: [],
            pendingActionCount: 0,
        };
    }

    // Count brand mentions per keyword
    const mentionedCount = records.filter(r => r.mentioned).length;
    const score = Math.round((mentionedCount / records.length) * 100);
    const grade = scoreToGrade(score);

    // Count competitor appearances
    const competitorCounts: Record<string, number> = {};
    for (const record of records) {
        for (const comp of record.competitorsMentioned) {
            competitorCounts[comp] = (competitorCounts[comp] ?? 0) + 1;
        }
    }

    // Detect top competitors (appears in 2+ queries)
    const topCompetitors = Object.entries(competitorCounts)
        .filter(([, count]) => count >= 2)
        .sort(([, a], [, b]) => b - a)
        .map(([name]) => name)
        .slice(0, 5);

    // Classify queries as branded vs generic.
    // Gap 3 fix: the heuristic keyword-length fallback (words.length <= 3) caused
    // generic short queries like "fiber internet" to be mis-classified as branded
    // when they happened to share tokens with the brand name.
    //
    // We now require explicit brandNames from the caller (API route injects
    // site.brandName + domainSlug). When none are available, branded detection
    // is intentionally disabled — all queries are treated as generic — which is
    // safer than producing false brandedQueriesFailing positives.
    const brandHints: string[] = brandNames; // Caller is responsible; see /api/aeo/diagnosis

    // Classify queries as branded vs generic
    const brandedRecords = records.filter(r => isBrandedQuery(r.keyword, brandHints));
    const genericRecords = records.filter(r => !isBrandedQuery(r.keyword, brandHints));

    const brandedFailing = brandedRecords.length > 0 && brandedRecords.every(r => !r.mentioned);
    const genericFailing = genericRecords.length > 0 && genericRecords.every(r => !r.mentioned);

    // Detect irrelevant results on branded queries (most severe pattern)
    const irrelevantOnBranded = brandedRecords.some(r => detectIrrelevantResults(r, unrelatedSignals));

    const patterns = {
        brandedQueriesFailing: brandedFailing,
        genericQueriesFailing: genericFailing,
        irrelevantResultsOnBranded: irrelevantOnBranded,
        topCompetitors,
    };

    // Build contextual primary problem message
    let primaryProblem: string;
    let explanation: string;

    if (irrelevantOnBranded) {
        primaryProblem = "AI has no entity association — recommending unrelated businesses for branded searches";
        explanation = `Your brand visibility score is ${score}%. More critically, when users search for your brand by name, AI engines are recommending businesses from completely unrelated industries. This means AI knowledge graphs have not yet associated your brand with your service category. This is the most severe AEO pattern and requires immediate entity-building actions.`;
    } else if (brandedFailing) {
        primaryProblem = "AI is not citing your brand even for direct branded queries";
        explanation = `Your brand visibility score is ${score}%. Even queries that include your brand name are not resulting in AI citations. This typically means there are insufficient external citations linking your brand name to your service on trusted web sources.`;
    } else if (genericFailing) {
        primaryProblem = "AI is not citing your brand for category-level queries";
        explanation = `Your brand visibility score is ${score}%. Industry category queries (e.g. 'fiber internet in [region]') are not returning your brand. Your competitors with stronger content coverage for these query phrases are being preferred. Create dedicated landing pages targeting these exact query phrases.`;
    } else if (score < 50) {
        primaryProblem = "Brand visibility is below 50% — AI cites competitors more than your brand";
        explanation = `Your brand visibility score is ${score}%. AI engines are more frequently citing your competitors over your brand for tracked queries. This impacts AI-driven discovery at scale.`;
    } else {
        primaryProblem = "Brand visibility is partially established but has room to improve";
        explanation = `Your brand visibility score is ${score}%. AI engines are citing your brand in ${mentionedCount} of ${records.length} tracked queries. Focus on the failing queries and content gaps identified in the action plan.`;
    }

    const actionPlan = buildActionPlan(patterns, score);

    return {
        score,
        grade,
        primaryProblem,
        explanation,
        competitorCounts,
        patterns,
        actionPlan,
        pendingActionCount: actionPlan.length,
    };
}
