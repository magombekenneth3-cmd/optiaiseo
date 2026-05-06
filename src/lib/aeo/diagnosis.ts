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
            why: "This is the most direct machine-readable signal telling AI knowledge graphs what your brand is, what industry it serves, and where it operates. When AI engines have no structured entity data, they guess — leading to completely wrong industry associations.",
            howSteps: [
                "Create a script tag with type=\"application/ld+json\" in your site's <head>",
                'Include: "@type": "Organization", "name": "[Brand]", "description": "[plain language description]"',
                'Add "url", "areaServed": {"@type": "Country", "name": "[Country]"}',
                'Add "serviceType": "[your service type, e.g. Internet Service Provider]"',
                'Add "sameAs": ["[Twitter URL]", "[LinkedIn URL]", "[Facebook URL]", "[Wikipedia URL if exists]"]',
                "Deploy the schema — validate at schema.org/SchemaApp or Google Rich Results Test",
                "Verify indexed in Google Search Console > Enhancements > Structured Data",
            ],
            estimatedImpact: "High — corrects AI entity confusion within 2–4 weeks of re-indexing.",
        });

        items.push({
            priority: "Critical",
            category: "Citations",
            title: "Get cited on authoritative regional tech and business publications",
            effort: "1 week",
            what: "Secure brand mentions with backlinks on African tech publications and ISP directories.",
            why: "AI engines learn brand-industry associations primarily from citation patterns across trusted web sources. Without external citations, the AI has no corroborating evidence to link your brand to its industry.",
            howSteps: [
                "Submit a press release or pitch to techcabal.com — Africa's leading tech publication",
                "Submit to disrupt-africa.com — startup and tech news for African markets",
                "Submit to itnewsafrica.com — IT news for African businesses",
                "Register in the Uganda Communications Commission directory at ucc.co.ug",
                "Add a Crunchbase profile with full company info and service description",
                "Submit to Cable.co.uk's global ISP listing database",
                "Ensure each listing uses identical brand name, address, and phone (NAP consistency)",
            ],
            estimatedImpact: "Very high — citation pattern is the primary AI training signal for entity-industry association.",
        });
    }

    if (patterns.genericQueriesFailing || score < 60) {
        items.push({
            priority: "High",
            category: "Content",
            title: "Create dedicated landing pages for each failed query phrase",
            effort: "1 day",
            what: "Build a dedicated optimized page for each specific query phrase that failed to cite your brand.",
            why: "AI engines extract answers from pages structured to directly answer the searched question. A generic homepage cannot compete with a page whose entire content is designed to answer one specific query.",
            howSteps: [
                "Identify the exact query phrases from your AEO tracking that showed 0% mention rate",
                "Create one page per failing query (e.g. /fiber-internet-uganda, /cheapest-internet-uganda)",
                "Put the exact query phrase in the H1, first 100 words, meta description, and title tag",
                "Add FAQPage schema with 5 questions — include: 'What is [brand]?', costs, speeds, coverage, contact",
                "Add LocalBusiness or ISP-specific schema with areaServed and serviceType",
                "Target 800–1,200 words with direct, factual answers — no marketing fluff",
                "Internally link these pages from the homepage and main navigation",
            ],
            estimatedImpact: "High — directly targets the query phrases you're failing. Results typically visible in 4–8 weeks.",
        });
    }

    items.push({
        priority: "High",
        category: "Schema",
        title: "Add FAQPage schema to homepage and main service pages",
        effort: "2 hours",
        what: "Add FAQPage structured data with 5 specific questions and direct answers on your key pages.",
        why: "FAQPage schema maps directly to the format AI engines use when generating responses. AI systems preferentially extract from pages that structure data in Q&A format matching their own output format.",
        howSteps: [
            'Add a script[type="application/ld+json"] block to homepage and service pages',
            'Use "@type": "FAQPage" with "mainEntity" array of Question/Answer pairs',
            'Required questions: "What is [Brand]?", "How much does [Brand] internet cost?", "What speeds does [Brand] offer?", "What areas does [Brand] cover?", "How do I contact [Brand]?"',
            "Each answer must be 1–2 sentences, factual, and contain the brand name",
            "Validate at Google Rich Results Test before publishing",
            "Check Google Search Console for FAQ eligibility after 2 weeks",
        ],
        estimatedImpact: "Medium-high — FAQ schema directly feeds AI response generation. Effect visible in 3–6 weeks.",
    });

    items.push({
        priority: "High",
        category: "Entity",
        title: "Create or claim a Wikipedia and Wikidata entry",
        effort: "1 day",
        what: "Get the brand listed on Wikipedia and Wikidata with full entity information.",
        why: "Wikipedia is primary training data for every major AI model. A Wikipedia entry directly increases AI mention probability for branded queries because AI systems treat Wikipedia as a ground-truth source for entity-industry associations.",
        howSteps: [
            "Search Wikipedia to verify no existing article covers the brand",
            "If none exists, draft an article covering: founding year, ownership, headquarters, service areas, notable facts",
            "Use Wikipedia's article wizard — ensure the topic meets notability guidelines (citations required)",
            "Add founding date, country of operation, service type, and parent company if applicable",
            "Create a corresponding Wikidata item and link it to the Wikipedia article",
            "Add the Wikipedia URL to the sameAs array in your Organization JSON-LD schema",
            "Note: Wikipedia articles must be neutral and cited — never promotional",
        ],
        estimatedImpact: "Very high for branded queries — Wikipedia is primary AI training data. Effect is permanent.",
    });

    items.push({
        priority: "Medium",
        category: "Technical",
        title: "Add an llms.txt file to the site root",
        effort: "30 minutes",
        what: "Create a plain text file at the domain root that tells AI crawlers what your site is about.",
        why: "llms.txt is an emerging standard (similar to robots.txt) that gives AI content crawlers machine-readable context about the site. It helps AI systems ingest your brand information correctly.",
        howSteps: [
            "Create a file at /llms.txt (or update the existing llms-txt route if it exists)",
            "Start with: # [Brand Name]",
            "> [Single sentence brand summary including industry and geography]",
            "Add a ## Services section listing each service with a plain description",
            "Add a ## Coverage section listing coverage areas",
            "Add a ## Contact section with website URL",
            "Test by visiting yourdomain.com/llms.txt — should return plain text",
        ],
        estimatedImpact: "Medium — helps AI crawlers at initial index time. Low effort, high signal density.",
    });

    items.push({
        priority: "Medium",
        category: "Citations",
        title: "Standardize NAP (Name, Address, Phone) across all directories",
        effort: "2 hours",
        what: "Ensure Name, Address, and Phone are exactly identical across every online presence.",
        why: "Inconsistent NAP data (e.g. 'Ltd' vs 'Limited' vs no suffix) degrades AI entity confidence. When data varies across sources, AI systems treat them as different entities, diluting your citation authority.",
        howSteps: [
            "Decide on one exact canonical brand name format and never deviate from it",
            "Update Google Business Profile with the canonical NAP",
            "Check and update: Facebook Business, LinkedIn Company, Twitter/X bio, Instagram bio",
            "Update all directory listings to use identical NAP",
            "Update the website footer to match exactly",
            "Use a NAP consistency checker tool (BrightLocal or Moz Local) to find remaining inconsistencies",
            "Document the canonical NAP in an internal brand style guide",
        ],
        estimatedImpact: "Medium — strengthens entity confidence across training sources. Cumulative effect over time.",
    });

    // ── GEO action items ─────────────────────────────────────────────────────
    items.push({
        priority: "High",
        category: "GEO",
        title: "Add transparent pricing and clear use-case pages",
        effort: "1 day",
        what: "Create a /pricing page and a 'Who it's for' section on your homepage.",
        why: "GEO is about being chosen, not just cited. AI skips brands with vague pricing or unclear positioning when recommending tools to buyers. Fitness signals — clear pricing, use cases, and reviews — are what make AI feel confident saying your name.",
        howSteps: [
            "Create /pricing with 2–3 named tiers, clear per-tier features, and a free trial or demo CTA",
            "Add a 'Who it's for' or 'Perfect for...' section to your homepage",
            "Add AggregateRating schema with real customer star ratings",
            "Add a '[Your Brand] vs [Competitor]' comparison page targeting a head-to-head keyword",
            "Publish 1–2 case studies with specific numbers (e.g. '30% more leads', '$5k/mo saved')",
        ],
        estimatedImpact: "High — GEO fixes directly increase your chances of being recommended by AI in commercial queries.",
    });

    // ── AIO action items ─────────────────────────────────────────────────────
    items.push({
        priority: "High",
        category: "AIO",
        title: "Fix your brand footprint so AI understands your business",
        effort: "2 hours",
        what: "Enrich your About page, add sameAs schema, and create an llms.txt file.",
        why: "AIO is about getting your brand understood by AI — not just ranked. If AI knowledge graphs lack reliable data about you (founding year, industry, verified profiles), AI will simply skip you even when you should be cited.",
        howSteps: [
            "Expand /about to include: founding year, team size, location, and mission — at least 400 words",
            "Add sameAs array to your Organization JSON-LD with links to LinkedIn, Twitter/X, Crunchbase, and any Wikipedia entry",
            "Create /llms.txt: start with # Brand Name, then a one-paragraph description and ## Services list",
            "Link all social profiles from your site footer with rel=me attributes",
            "Ensure Name/Address/Phone is identical in footer, Contact page, Google Business Profile, and schema",
        ],
        estimatedImpact: "Very high — AIO fixes teach AI who you are. Without them, AI cannot safely talk about your brand.",
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
        explanation = `Your brand visibility score is ${score}%. AI engines are citing your competitors roughly ${100 - score}% more than your brand. This impacts AI-driven discovery at scale.`;
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
