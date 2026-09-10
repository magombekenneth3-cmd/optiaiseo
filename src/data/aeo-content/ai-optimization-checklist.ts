import type { AeoGuideContent } from "./types";

export const content: AeoGuideContent = {
  slug: "ai-optimization-checklist",
  intro: "Use this checklist to systematically audit any page for AI search readiness. Work through each item before publishing or when updating existing content. Items are ordered by impact.",
  sections: [
    { heading: "Content Structure Checklist", body: "☐ Page leads with a direct 2–3 sentence answer in the first paragraph. ☐ Primary heading (H1) matches the exact target query or a close natural-language variant. ☐ Section headings (H2/H3) are formatted as questions users would ask. ☐ Each section heading is followed immediately by its direct answer paragraph. ☐ Content avoids unnecessary preamble before the main answer. ☐ Key facts and data points are stated explicitly (not implied)." },
    { heading: "Structured Data Checklist", body: "☐ FAQPage JSON-LD schema present for pages with multiple Q&A pairs. ☐ HowTo JSON-LD schema present for step-by-step procedural content. ☐ Article schema present with headline, author, datePublished, dateModified. ☐ BreadcrumbList schema present. ☐ All schema validated with Google Rich Results Test — zero errors. ☐ Schema matches rendered page content (no misleading markup)." },
    { heading: "E-E-A-T Signals Checklist", body: "☐ Author name and bio present with verifiable credentials. ☐ Publication date and last-modified date displayed. ☐ Primary sources cited and linked (studies, reports, official documentation). ☐ Page reviewed or updated in the last 12 months. ☐ Domain has backlinks from recognized industry publications. ☐ About page and contact information accessible from the page." },
    { heading: "Technical Readiness Checklist", body: "☐ Page is indexed (not blocked by robots.txt or noindex). ☐ Canonical URL set correctly. ☐ Page passes Core Web Vitals (LCP < 2.5s, INP < 200ms, CLS < 0.1). ☐ Content renders without JavaScript (AI crawlers may not execute JS). ☐ PerplexityBot, GPTBot, ClaudeBot, and Google-Extended are allowed in robots.txt. ☐ sitemap.xml includes this URL." },
    { heading: "Internal Linking Checklist", body: "☐ Page links to related pages on the same topic cluster. ☐ Hub/pillar page links to this spoke page. ☐ Anchor text is descriptive (not 'click here' or 'read more'). ☐ Related pages link back to this page where contextually appropriate. ☐ Page is reachable within 3 clicks from the homepage." },
    { heading: "FAQ Quality Checklist", body: "☐ FAQs address questions users actually search for (verify with GSC queries). ☐ Each FAQ answer is complete on its own — not 'see above.' ☐ FAQ answers are concise (2–4 sentences each). ☐ No duplicate questions or near-identical answers across pages. ☐ At least 3 unique FAQs per page." },
  ],
  faqs: [
    { q: "How often should I run this checklist on existing pages?", a: "Run a full checklist audit quarterly on your top 20 pages. For all other pages, use OptiAISEO's automated AEO audit to flag issues continuously and prioritize pages by traffic impact." },
    { q: "Which checklist items matter most for ChatGPT vs Google AI Overviews?", a: "For ChatGPT: content structure and specific data points matter most. For Google AI Overviews: traditional ranking strength plus structured data markup. For Perplexity: content structure plus domain authority signals. The full checklist covers all three." },
    { q: "Should I prioritize this checklist for new pages or existing pages?", a: "Prioritize existing high-traffic pages first — they have the most to gain from AI citation optimization. Apply the checklist to new pages before publishing to build good habits." },
  ],
};
