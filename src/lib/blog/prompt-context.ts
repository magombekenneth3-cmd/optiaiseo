export type SearchIntent =
    | "informational"
    | "commercial"
    | "transactional"
    | "local"
    | "navigational";

export type BusinessType =
    | "saas"
    | "ecommerce"
    | "local"
    | "publisher"
    | "finance"
    | "health"
    | "legal"
    | "education"
    | "unknown";

export type RiskTier = "low" | "medium" | "high";

export interface PromptContext {
    keyword: string;
    category: string;
    intent: SearchIntent;
    riskTier: RiskTier;
    isLocalTopic: boolean;
    hasAuthorGrounding: boolean;
    businessType: BusinessType;
    displayName?: string;
    siteDomain?: string;
    year: number;
}

const HIGH_RISK = /\b(invest|trading|stock|fund|portfolio|financ|insurance|mortgage|tax|loan|credit|health|medical|diagnos|treatment|therapy|prescription|drug|legal|law|lawsuit|attorney|solicitor|compliance|regulat)\b/i;

const MEDIUM_RISK = /\b(supplement|vitamin|fitness|diet|weight loss|career|salary|hiring|recruit|mental health|anxiety|depression|counseling)\b/i;

const LOCAL_HINT = /\b(near me|nearby|in\s+[a-zA-Z\s]+|city|town|area|restaurant|clinic|hotel|salon|shop)\b/i;

const TRANSACTIONAL = /\b(buy|price|pricing|cost|cheap|deal|order|hire|get|sign up|download|purchase|subscribe)\b/i;

const COMMERCIAL = /\b(best|top|vs|versus|compare|comparison|review|alternative|alternatives|recommend|ranking)\b/i;

const NAVIGATIONAL = /\b(login|dashboard|pricing page|homepage|site|official|docs|documentation)\b/i;

function normalize(text: string) {
    return text.toLowerCase();
}

export function detectIntent(keyword: string): SearchIntent {
    const kw = normalize(keyword);

    if (TRANSACTIONAL.test(kw)) return "transactional";
    if (COMMERCIAL.test(kw)) return "commercial";
    if (LOCAL_HINT.test(kw)) return "local";
    if (NAVIGATIONAL.test(kw)) return "navigational";

    return "informational";
}

export function detectRiskTier(keyword: string, category: string, intent: SearchIntent): RiskTier {
    const text = `${keyword} ${category}`.toLowerCase();

    const isHigh = HIGH_RISK.test(text) && (intent === "transactional" || intent === "informational");
    if (isHigh) return "high";

    const isMedium = MEDIUM_RISK.test(text);
    if (isMedium) return "medium";

    return "low";
}

export function detectBusinessType(keyword: string, category: string, domain?: string): BusinessType {
    const text = `${keyword} ${category} ${domain ?? ""}`.toLowerCase();

    if (/\b(legal|law|attorney|solicitor|lawsuit)\b/.test(text)) return "legal";
    if (/\b(health|medical|clinic|diagnos|treatment|therapy|drug)\b/.test(text)) return "health";
    if (/\b(financ|invest|trading|stock|tax|loan|insurance)\b/.test(text)) return "finance";
    if (/\b(course|learn|education|training|certif|tutor)\b/.test(text)) return "education";
    if (/\b(shop|store|buy|product|ecommerce|cart)\b/.test(text)) return "ecommerce";
    if (/\b(software|app|saas|platform|tool|api|dashboard)\b/.test(text)) return "saas";
    if (LOCAL_HINT.test(text)) return "local";

    return "unknown";
}

export function detectLocalTopic(keyword: string): boolean {
    return LOCAL_HINT.test(keyword.toLowerCase());
}

export function cleanDomainToDisplayName(domain: string): string {
    return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\.(up\.railway|netlify|vercel|herokuapp|pages|web)\.app$/, "")
        .replace(/\.(com|co|io|net|org|app)(\/.*)?$/, "")
        .split(".")[0]
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim() || "Our Platform";
}

export function buildPromptContext(params: {
    keyword: string;
    category: string;
    intent?: SearchIntent;
    hasAuthorGrounding: boolean;
    displayName?: string;
    siteDomain?: string;
}): PromptContext {
    const keyword = params.keyword;
    const category = params.category;

    const intent = params.intent ?? detectIntent(keyword);
    const businessType = detectBusinessType(keyword, category, params.siteDomain);

    return {
        keyword,
        category,
        intent,
        riskTier: detectRiskTier(keyword, category, intent),
        isLocalTopic: detectLocalTopic(keyword),
        hasAuthorGrounding: params.hasAuthorGrounding,
        businessType,
        displayName: params.displayName ?? cleanDomainToDisplayName(params.siteDomain ?? ""),
        siteDomain: params.siteDomain,
        year: new Date().getFullYear()
    };
}