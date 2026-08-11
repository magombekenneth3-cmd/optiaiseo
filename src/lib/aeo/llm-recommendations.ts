import { extractBrandIdentity } from "./brand-utils";

export interface LlmFormattingRule {
    id: string;
    type: "micro_answer" | "information_gain" | "wikidata_linkage" | "structured_markdown" | "llms_txt";
    title: string;
    rule: string;
    codeSnippet?: string;
    exampleBefore?: string;
    exampleAfter?: string;
    targetLLMs: string[];
    estimatedImpact: "High" | "Critical" | "Medium";
}

export function generateLlmOptimizationRules(
    domain: string,
    pageHtml?: string,
    coreServices?: string | null
): LlmFormattingRule[] {
    const brand = extractBrandIdentity(domain).displayName;
    const cleanHtml = pageHtml?.toLowerCase() ?? "";

    const rules: LlmFormattingRule[] = [];

    const hasMicroAnswer = /<p[^>]*>[^<]{30,250}<\/p>/i.test(cleanHtml) &&
        /(is a|refers to|defined as|consists of|helps with)/i.test(cleanHtml);

    if (!hasMicroAnswer) {
        rules.push({
            id: "llm-rule-micro-answer",
            type: "micro_answer",
            title: "Direct 40-Word Answer Block (RAG Optimization)",
            rule: "Insert a 30-50 word direct, factual definition paragraph immediately below the main H1 or question H2. Avoid promotional fluff or preamble.",
            exampleBefore: "Welcome to our website! We offer amazing services that help businesses grow faster.",
            exampleAfter: `${brand} is a platform providing ${coreServices || "enterprise solutions"} designed to optimize digital presence, automate workflows, and improve generative search visibility.`,
            targetLLMs: ["Perplexity", "ChatGPT Search", "Google AI Overviews", "Claude"],
            estimatedImpact: "Critical",
        });
    }

    const hasStats = /\b(\d{1,3}%|\d+ percent|1 in \d+|benchmark|dataset)\b/i.test(cleanHtml);
    if (!hasStats) {
        rules.push({
            id: "llm-rule-information-gain",
            type: "information_gain",
            title: "High Information Gain & Verifiable Statistics",
            rule: "Embed original data points, specific percentages, and named source attributions within bulleted lists. LLM scrapers prioritize high Information Gain metrics over generic claims.",
            exampleBefore: "Our customers save a lot of time using our software.",
            exampleAfter: "According to our 2026 audit, users achieved a 42% reduction in manual optimization tasks within 30 days of deployment.",
            targetLLMs: ["Perplexity", "Gemini", "ChatGPT Search", "DeepSeek"],
            estimatedImpact: "High",
        });
    }

    const hasSameAs = cleanHtml.includes("sameas") && cleanHtml.includes("wikidata");
    if (!hasSameAs) {
        rules.push({
            id: "llm-rule-wikidata-linkage",
            type: "wikidata_linkage",
            title: "JSON-LD sameAs Wikidata & Knowledge Graph Linkages",
            rule: "Include a sameAs array in your Organization and Product JSON-LD schema linking to authoritative Wikidata, Wikipedia, Crunchbase, and LinkedIn entity URIs.",
            codeSnippet: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "${brand}",
  "url": "https://${domain}",
  "sameAs": [
    "https://www.wikidata.org/wiki/Q123456",
    "https://www.linkedin.com/company/${domain.split('.')[0]}",
    "https://crunchbase.com/organization/${domain.split('.')[0]}"
  ]
}
</script>`,
            targetLLMs: ["Google AI Overviews", "ChatGPT Search", "Claude", "Gemini"],
            estimatedImpact: "Critical",
        });
    }

    const hasMarkdownTable = /<table|\|.*\|/i.test(cleanHtml);
    if (!hasMarkdownTable) {
        rules.push({
            id: "llm-rule-structured-markdown",
            type: "structured_markdown",
            title: "Structured Comparison Table for Feature Parsing",
            rule: "Format key features, pricing tiers, or competitor comparisons using clean HTML/Markdown tables. LLM RAG engines directly extract tabular data for comparison queries.",
            codeSnippet: `| Feature | ${brand} | Standard Solution |
| --- | --- | --- |
| AEO Score | Real-Time | Manual |
| Automated PRs | Yes | No |`,
            targetLLMs: ["Perplexity", "ChatGPT Search", "Claude"],
            estimatedImpact: "High",
        });
    }

    const hasLlmsTxt = cleanHtml.includes("llms.txt");
    if (!hasLlmsTxt) {
        rules.push({
            id: "llm-rule-llms-txt",
            type: "llms_txt",
            title: "Standard /llms.txt Machine-Readable Index",
            rule: "Provide a plain-text /llms.txt file at the root of your domain specifying your brand summary, core API routes, and primary documentation for AI crawlers.",
            codeSnippet: `# ${brand}
> ${coreServices || "AI SEO & AEO Strategy Engine"}

## Core Products
- AEO Audit: https://${domain}/dashboard/aeo
- Voice Agent: https://${domain}/dashboard/voice`,
            targetLLMs: ["GPTBot", "PerplexityBot", "ClaudeBot", "Google-Extended"],
            estimatedImpact: "Medium",
        });
    }

    return rules;
}
