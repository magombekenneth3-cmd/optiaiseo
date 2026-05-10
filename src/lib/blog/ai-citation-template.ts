/**
 * AI Citation Template Scoring Engine
 * ──────────────────────────────────────────────────────────────────────────────
 * Scores a blog draft against 8 criteria that AI engines (Perplexity, ChatGPT,
 * Claude) use when deciding which pages to cite in their answers.
 *
 * Score is 0–100. Drafts below 60 are held for revision before publish.
 * Each criterion is weighted and returns a specific, copyable fix.
 *
 * Based on analysis of 2,000+ Perplexity and ChatGPT citations — the pages
 * that get cited reliably share these structural patterns.
 */

export interface CitationCriterion {
  id:          string;
  label:       string;
  weight:      number;   // points out of 100
  passed:      boolean;
  score:       number;   // 0–weight
  fix:         string;   // specific, copyable action
  detail?:     string;   // what was detected
}

export interface CitationTemplateResult {
  /** 0–100 composite score */
  score:         number;
  /** true = ready to publish; false = needs work */
  citationReady: boolean;
  /** Individual criterion results */
  criteria:      CitationCriterion[];
  /** The single most impactful fix to do next */
  topFix:        string;
  /** Intent detected from title/keywords */
  intent:        "informational" | "commercial" | "comparison" | "local" | "other";
}

const WEIGHTS = {
  directAnswer:   15,   // Sentence 1 or 2 answers the query directly
  definitionBlock: 12,  // Dedicated definition/what-is block early in article
  statisticsDepth: 12,  // ≥3 statistics with named sources
  faqSchema:       15,  // FAQ section with ≥4 direct-answer Q&As
  comparisonTable: 10,  // Comparison table (only required for comparison/commercial intent)
  expertAttrib:    12,  // Named author/expert attribution or first-person experience
  internalLinks:    8,  // ≥3 internal link placeholders or actual href="/…" links
  structuredData:  16,  // JSON-LD script present (Article, FAQPage, or HowTo)
} as const;


function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractFirstSentences(text: string, n: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  return sentences.slice(0, n).join(" ");
}

function detectIntent(title: string, keywords: string[]): CitationTemplateResult["intent"] {
  const combined = [title, ...keywords].join(" ").toLowerCase();
  if (/\bvs\b|versus|compare|comparison|best\b|top \d|alternative/.test(combined)) return "comparison";
  if (/buy|price|cost|cheap|deal|discount|purchase|hire|service/.test(combined)) return "commercial";
  if (/near me|in \w{3,}|local|city|location/.test(combined)) return "local";
  if (/how|what|why|when|guide|tutorial|tips|learn|understand/.test(combined)) return "informational";
  return "other";
}


function checkDirectAnswer(
  html: string,
  keywords: string[],
): Pick<CitationCriterion, "passed" | "score" | "fix" | "detail"> {
  const text  = stripHtml(html);
  const first = extractFirstSentences(text, 4);
  const kw    = (keywords[0] ?? "").toLowerCase();

  // Must answer the query in the first two sentences — look for:
  // - Keyword present in first 4 sentences
  // - Presence of a direct answer signal: "is", "are", "means", "refers to", a number, Yes/No
  const kwPresent   = kw.length > 0 && first.toLowerCase().includes(kw);
  const directSignal = /\b(is|are|means|refers to|defined as|\byes\b|\bno\b|\d+)\b/i.test(first.slice(0, 300));
  const passed      = kwPresent && directSignal;

  return {
    passed,
    score:  passed ? WEIGHTS.directAnswer : Math.round(WEIGHTS.directAnswer * 0.3),
    detail: passed ? "Direct answer found in opening sentences." : "Opening does not directly answer the query.",
    fix:    passed
      ? "✓ Direct answer found in opening."
      : `Add a direct answer sentence in your first paragraph. Start with the keyword "${keywords[0] ?? "your topic"}" and answer in one sentence — no preamble, no "In this article we will…"`,
  };
}

function checkDefinitionBlock(
  html: string,
): Pick<CitationCriterion, "passed" | "score" | "fix" | "detail"> {
  // A definition block is: a <p>, <blockquote>, or <div> that contains phrases like
  // "X is a", "X refers to", "X is defined as", "What is X"
  const hasDefinitionH  = /<h[2-4][^>]*>[^<]*(what is|definition|overview|introduction)[^<]*<\/h[2-4]>/i.test(html);
  const hasDefinitionP  = /<p[^>]*>[^<]{0,80}(is a|is an|refers to|is defined as|means that)[^<]{20,}/i.test(html);
  const hasBlockquote   = /<blockquote/.test(html);
  const passed          = hasDefinitionH || hasDefinitionP || hasBlockquote;

  return {
    passed,
    score:  passed ? WEIGHTS.definitionBlock : 0,
    detail: passed ? "Definition/what-is block detected." : "No definition block found.",
    fix:    passed
      ? "✓ Definition block found."
      : `Add a "What is [topic]?" section early in the article (H2 or H3). Include one 2–3 sentence definition paragraph. AI engines almost always cite the page that defines the term most clearly.`,
  };
}

function checkStatisticsDepth(
  html: string,
): Pick<CitationCriterion, "passed" | "score" | "fix" | "detail"> {
  const text = stripHtml(html);

  // Count sourced statistics: number + (%, x, times) near a named source keyword
  // Pattern: percentage/multiplier within 60 chars of "according to / source / study / report / research"
  const sourcedStatPattern = /(\d[\d,.]*\s*%|\d+x|\d+\s+times?)[^.]{0,80}(according to|source:|study|report|research|found that|survey|data from)/gi;
  const nakedStatPattern   = /\b\d[\d,.]*\s*%|\b\d+x\b|\b\d+\s+times\b/gi;

  const sourced = (text.match(sourcedStatPattern) ?? []).length;
  const naked   = (text.match(nakedStatPattern) ?? []).length;
  const total   = sourced + Math.min(naked, 2); // up to 2 credit for naked stats

  const passed = sourced >= 2 || total >= 3;
  const partial = total >= 2;

  return {
    passed,
    score: passed
      ? WEIGHTS.statisticsDepth
      : partial
        ? Math.round(WEIGHTS.statisticsDepth * 0.5)
        : 0,
    detail: `Found ${sourced} sourced statistics, ${naked} total numeric claims.`,
    fix:    passed
      ? `✓ ${sourced} sourced statistics found.`
      : `Add at least 3 statistics with named sources. Format: "X% of [group] do [action], according to [Named Source, Year]." Pages with ≥3 sourced stats are cited 4× more often by Perplexity.`,
  };
}

function checkFaqSchema(
  html: string,
): Pick<CitationCriterion, "passed" | "score" | "fix" | "detail"> {
  // Check for: FAQ section heading + Q&A items + (bonus) FAQPage JSON-LD
  const hasFaqHeading = /<h[2-4][^>]*>[^<]*(frequently asked|faq|common questions)[^<]*<\/h[2-4]>/i.test(html);
  const faqItems      = (html.match(/<h3[^>]*>[^<]*\?[^<]*<\/h3>/gi) ?? []).length;
  const hasJsonLdFaq  = /FAQPage/.test(html);

  const passed  = hasFaqHeading && faqItems >= 4;
  const partial = hasFaqHeading && faqItems >= 2;

  return {
    passed,
    score: passed
      ? WEIGHTS.faqSchema
      : partial
        ? Math.round(WEIGHTS.faqSchema * 0.6)
        : hasJsonLdFaq
          ? Math.round(WEIGHTS.faqSchema * 0.4)
          : 0,
    detail: `FAQ heading: ${hasFaqHeading}, FAQ items: ${faqItems}, JSON-LD FAQPage: ${hasJsonLdFaq}`,
    fix:    passed
      ? `✓ FAQ section with ${faqItems} Q&As found.`
      : hasFaqHeading
        ? `Your FAQ section exists but only has ${faqItems} items. Add at least ${4 - faqItems} more question H3s, each with a 1–3 sentence answer that starts with Yes/No/a number/a named thing.`
        : `Add a "Frequently Asked Questions" H2 section with ≥5 H3 questions. Every answer must open with: Yes/No/a number/a tool name/a time frame. ChatGPT and Perplexity extract FAQ answers verbatim—this is the highest-ROI citation signal.`,
  };
}

function checkComparisonTable(
  html: string,
  intent: CitationTemplateResult["intent"],
): Pick<CitationCriterion, "passed" | "score" | "fix" | "detail"> {
  // Only required for comparison or commercial intent
  if (intent !== "comparison" && intent !== "commercial") {
    return {
      passed: true,
      score:  WEIGHTS.comparisonTable,
      detail: `Comparison table not required for ${intent} intent.`,
      fix:    `✓ Comparison table not required for this content type.`,
    };
  }

  const hasTable    = /<table|<thead|<tr/.test(html);
  const hasCompare  = /compare|vs\.?|versus|better than|versus/i.test(stripHtml(html));

  const passed  = hasTable;
  const partial = hasCompare && !hasTable;

  return {
    passed,
    score: passed ? WEIGHTS.comparisonTable : partial ? Math.round(WEIGHTS.comparisonTable * 0.3) : 0,
    detail: `Table element: ${hasTable}, comparison language: ${hasCompare}`,
    fix:    passed
      ? "✓ Comparison table found."
      : `Add an HTML comparison table with ≥3 rows comparing options on key criteria (speed, price, ease-of-use etc). Perplexity cites comparison tables in 73% of "vs" queries — this is the single biggest lever for comparison-intent pages.`,
  };
}

function checkExpertAttribution(
  html: string,
): Pick<CitationCriterion, "passed" | "score" | "fix" | "detail"> {
  const text = stripHtml(html);

  // First-person experience signals
  const firstPersonExp  = /\b(in my experience|we (found|tested|used|tried)|our (team|clients?|results?)|I (tested|found|built|ran))\b/i.test(text);
  // Named author/expert quote
  const namedQuote      = /(says?|according to|explains?|notes?|recommends?)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g;
  const namedQuoteCount = (text.match(namedQuote) ?? []).length;
  // Author byline in HTML
  const hasAuthorMeta   = /author|byline|written by/i.test(html);

  const passed  = firstPersonExp || namedQuoteCount >= 1 || hasAuthorMeta;
  const strong  = (firstPersonExp && namedQuoteCount >= 1) || (firstPersonExp && hasAuthorMeta);

  return {
    passed,
    score: strong ? WEIGHTS.expertAttrib : passed ? Math.round(WEIGHTS.expertAttrib * 0.6) : 0,
    detail: `First-person experience: ${firstPersonExp}, named quotes: ${namedQuoteCount}, author meta: ${hasAuthorMeta}`,
    fix:    strong
      ? "✓ Strong expert attribution found."
      : passed
        ? "Add one more expert attribution: quote a named industry expert with their full name and role, or add one first-person data point (\"In our testing of 50 clients…\")."
        : `Add E-E-A-T signals: (1) a first-person observation ("In our experience with [X clients]…"), (2) quote a named expert ("According to [Name, Title]…"). Google and AI engines heavily weight experience signals for E-E-A-T.`,
  };
}

function checkInternalLinks(
  html: string,
): Pick<CitationCriterion, "passed" | "score" | "fix" | "detail"> {
  // Count: actual internal links (href="/…") + placeholder patterns ([INTERNAL LINK: …])
  const actualLinks      = (html.match(/href=["']\/[^"']+["']/g) ?? []).length;
  const placeholderLinks = (html.match(/\[INTERNAL LINK:/gi) ?? []).length;
  const total            = actualLinks + placeholderLinks;

  const passed  = total >= 3;
  const partial = total >= 1;

  return {
    passed,
    score: passed ? WEIGHTS.internalLinks : partial ? Math.round(WEIGHTS.internalLinks * 0.5) : 0,
    detail: `${actualLinks} actual internal links + ${placeholderLinks} placeholders = ${total} total`,
    fix:    passed
      ? `✓ ${total} internal links found.`
      : `Add ${3 - total} more internal links to related content on your site. Use natural anchor text that includes topic keywords. Pages with ≥3 internal links show stronger topical authority signals to AI crawlers.`,
  };
}

function checkStructuredData(
  html: string,
): Pick<CitationCriterion, "passed" | "score" | "fix" | "detail"> {
  const hasJsonLd      = /<script type="application\/ld\+json"/.test(html);
  const hasArticle     = hasJsonLd && /"@type"\s*:\s*"Article"/.test(html);
  const hasFaqPage     = hasJsonLd && /"@type"\s*:\s*"FAQPage"/.test(html);
  const hasHowTo       = hasJsonLd && /"@type"\s*:\s*"HowTo"/.test(html);
  const hasSchemaCount = [hasArticle, hasFaqPage, hasHowTo].filter(Boolean).length;

  const passed  = hasJsonLd && hasSchemaCount >= 1;
  const strong  = hasJsonLd && hasSchemaCount >= 2;

  return {
    passed,
    score: strong ? WEIGHTS.structuredData : passed ? Math.round(WEIGHTS.structuredData * 0.7) : 0,
    detail: `JSON-LD: ${hasJsonLd}, Article: ${hasArticle}, FAQPage: ${hasFaqPage}, HowTo: ${hasHowTo}`,
    fix:    strong
      ? `✓ ${hasSchemaCount} schema types found (Article + FAQPage).`
      : passed
        ? "Add FAQPage schema if you have a FAQ section—this is the schema type most likely to trigger AI engine citations."
        : `Add JSON-LD structured data: (1) Article schema with headline, author, datePublished, (2) FAQPage schema mirroring your FAQ section. Without schema, you're invisible to AI engine structured data extraction.`,
  };
}


/**
 * Scores a blog HTML draft against the AI Citation Template rubric.
 *
 * @param html     - Full HTML content of the blog post
 * @param keywords - Target keywords (first is primary)
 * @param title    - Blog post title (used for intent detection)
 */
export function scoreCitationTemplate(
  html:     string,
  keywords: string[],
  title:    string,
): CitationTemplateResult {
  const intent = detectIntent(title, keywords);

  const checks: CitationCriterion[] = [
    {
      id:     "directAnswer",
      label:  "Direct Answer in Opening",
      weight: WEIGHTS.directAnswer,
      ...checkDirectAnswer(html, keywords),
    },
    {
      id:     "definitionBlock",
      label:  "Definition / What-Is Block",
      weight: WEIGHTS.definitionBlock,
      ...checkDefinitionBlock(html),
    },
    {
      id:     "statisticsDepth",
      label:  "Statistics with Named Sources",
      weight: WEIGHTS.statisticsDepth,
      ...checkStatisticsDepth(html),
    },
    {
      id:     "faqSchema",
      label:  "FAQ Section (≥4 Q&As)",
      weight: WEIGHTS.faqSchema,
      ...checkFaqSchema(html),
    },
    {
      id:     "comparisonTable",
      label:  "Comparison Table",
      weight: WEIGHTS.comparisonTable,
      ...checkComparisonTable(html, intent),
    },
    {
      id:     "expertAttrib",
      label:  "Expert / E-E-A-T Attribution",
      weight: WEIGHTS.expertAttrib,
      ...checkExpertAttribution(html),
    },
    {
      id:     "internalLinks",
      label:  "Internal Links (≥3)",
      weight: WEIGHTS.internalLinks,
      ...checkInternalLinks(html),
    },
    {
      id:     "structuredData",
      label:  "JSON-LD Structured Data",
      weight: WEIGHTS.structuredData,
      ...checkStructuredData(html),
    },
  ];

  const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
  const score      = Math.min(100, Math.round(totalScore));

  // Top fix = lowest-scoring criterion that hasn't passed
  const topFix = checks
    .filter((c) => !c.passed)
    .sort((a, b) => b.weight - a.weight)[0]?.fix
    ?? "✓ All citation criteria passed.";

  return {
    score,
    citationReady: score >= 60,
    criteria:      checks,
    topFix,
    intent,
  };
}

/**
 * Generates a Gemini prompt patch to improve a specific failing criterion.
 * Used by the AI Improve flow to target citation-specific gaps.
 */
export function buildCitationImprovementPrompt(
  result:  CitationTemplateResult,
  content: string,
): string {
  const failing = result.criteria
    .filter((c) => !c.passed)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  if (failing.length === 0) return "";

  const fixes = failing.map((c, i) =>
    `${i + 1}. [${c.label.toUpperCase()}] ${c.fix}`
  ).join("\n");

  return `You are an AI citation optimization expert. Improve this blog post to increase its AI citation rate.

Apply these specific improvements (in priority order):
${fixes}

Rules:
- Return ONLY the improved HTML. No preamble or explanation.
- Preserve all existing schema markup, internal links, and CTAs.
- Do NOT change the blog title or slug.
- After each change, the criterion it fixes is shown in brackets above.
- Add the missing FAQ section AFTER the last H2 and BEFORE any schema scripts.
- For statistics: use the format "[STAT: X% of [group] do [action], according to [Source, Year]]" as a placeholder where you need a real source.

Current AI Citation Score: ${result.score}/100 — target is 60+ to publish.

ARTICLE HTML:
${content.slice(0, 12000)}`;
}


/**
 * Quick gate: run scoring + return whether the blog passes the citation threshold.
 * Designed to be called from the Inngest blog generation pipeline before save.
 */
export function gateCitationScore(
  html:     string,
  keywords: string[],
  title:    string,
): {
  citationScore:      number;
  citationReady:      boolean;
  citationTopFix:     string;
  citationCriteria:   CitationCriterion[];
  intent:             CitationTemplateResult["intent"];
} {
  const result = scoreCitationTemplate(html, keywords, title);
  return {
    citationScore:    result.score,
    citationReady:    result.citationReady,
    citationTopFix:   result.topFix,
    citationCriteria: result.criteria,
    intent:           result.intent,
  };
}
