import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import SiteFooter from "@/components/marketing/SiteFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

// ── Guide content data ────────────────────────────────────────────────────────
// Each slug targets a specific low-competition long-tail query.

export const GUIDES: Record<string, {
  title: string;
  description: string;
  h1: string;
  intro: string;
  sections: { heading: string; body: string }[];
  faqs: { q: string; a: string }[];
  cta: string;
  related: { href: string; label: string }[];
}> = {
  "how-to-rank-in-chatgpt": {
    title: "How to Rank in ChatGPT Answers (2026 Guide) | OptiAISEO",
    description: "Learn exactly how to get your brand cited in ChatGPT responses. Step-by-step AEO guide covering schema, entity optimization, and citation tracking.",
    h1: "How to Rank in ChatGPT Answers in 2026",
    intro: "ChatGPT, Claude, and Perplexity now answer millions of questions that used to go to Google. Unlike traditional search, these models don't rank blue links — they cite sources. Getting cited requires a different strategy: Answer Engine Optimization (AEO). This guide covers exactly what you need to do.",
    sections: [
      {
        heading: "Why ChatGPT cites some brands and not others",
        body: "Large language models are trained on web data. They learn which brands, products, and organizations are authoritative by analysing how often they appear in high-quality sources — Wikipedia, trusted blogs, Reddit discussions, and news sites. If your brand is mentioned frequently in authoritative contexts, ChatGPT is more likely to recommend it. The key insight: you don't optimize for ChatGPT directly — you optimize for the sources ChatGPT trusts.",
      },
      {
        heading: "Step 1: Implement structured data (JSON-LD schema)",
        body: "Schema markup tells AI crawlers exactly what your product does, who it serves, and what category it belongs to. At minimum, implement: Organization schema (name, description, url, sameAs), Product or SoftwareApplication schema with pricing and features, FAQPage schema on every page that answers a question. OptiAISEO automatically injects and validates all required schema types — run a free audit to see what's missing.",
      },
      {
        heading: "Step 2: Build entity associations",
        body: "AI models understand entities — named things with relationships. To get cited, your brand needs strong entity associations: What category is it in? What problem does it solve? Who uses it? Build these by creating content that explicitly defines your category (e.g. 'OptiAISEO is a Generative Engine Optimization platform'), getting mentioned on authoritative third-party sites, and ensuring consistent NAP (name, address, phone) data across directories.",
      },
      {
        heading: "Step 3: Publish factual, citable content",
        body: "ChatGPT prefers to cite content that is factual, structured, and specific. Write content with clear definitions, named statistics, and attributed claims. Use headers, bullet points, and numbered lists — these are easy for AI to parse and extract. Avoid marketing fluff; write like an encyclopedia entry for your category.",
      },
      {
        heading: "Step 4: Track your Generative Share of Voice (gSOV)",
        body: "gSOV measures how often your brand appears in AI answers compared to competitors. Run weekly prompts like 'best AI SEO tools', 'alternatives to Semrush', and 'how to track AI citations' — then log whether your brand is cited. OptiAISEO automates this tracking and alerts you when competitors gain or lose citation share.",
      },
    ],
    faqs: [
      { q: "How long does it take to rank in ChatGPT?", a: "Most brands see their first ChatGPT citations within 3–6 months of implementing AEO best practices. The timeline depends on your existing domain authority and how aggressively you build entity associations." },
      { q: "Does Google SEO help with ChatGPT rankings?", a: "Partially. Google authority signals (backlinks, E-E-A-T) correlate with AI citation rates because both measure trustworthiness. But AEO requires additional steps: schema markup, entity definitions, and structured factual content that traditional SEO doesn't require." },
      { q: "What schema type helps most for ChatGPT citations?", a: "Organization, FAQPage, and Article schema have the highest correlation with AI citations. SoftwareApplication schema is critical if you're a SaaS product." },
    ],
    cta: "Track your ChatGPT citation rate free",
    related: [
      { href: "/aeo", label: "AEO Guide" },
      { href: "/geo", label: "GEO Guide" },
      { href: "/free/gso-checker", label: "Free AI visibility checker" },
      { href: "/guide/generative-engine-optimization-checklist", label: "GEO checklist" },
    ],
  },

  "generative-engine-optimization-checklist": {
    title: "Generative Engine Optimization Checklist 2026 | OptiAISEO",
    description: "Complete GEO checklist: 23 actions to get your brand cited in ChatGPT, Claude, Perplexity and Google AI Overviews. Free, actionable, updated for 2026.",
    h1: "Generative Engine Optimization (GEO) Checklist — 23 Actions for 2026",
    intro: "Generative Engine Optimization (GEO) is the practice of structuring your website, content, and brand presence so AI models cite you in their answers. This checklist covers every technical and content action you need to take, ordered by impact.",
    sections: [
      {
        heading: "Technical foundation (do these first)",
        body: "1. Implement Organization JSON-LD schema on every page. 2. Add FAQPage schema to all pages that answer questions. 3. Add Article schema with datePublished and dateModified to every blog post. 4. Verify your robots.txt allows GPTBot, PerplexityBot, ClaudeBot, and Googlebot. 5. Create and publish an llms.txt file at yourdomain.com/llms.txt listing your key pages. 6. Ensure all canonical URLs are absolute (https://yourdomain.com/page, not /page). 7. Fix any broken internal links — AI crawlers follow the same links as Googlebot.",
      },
      {
        heading: "Content structure",
        body: "8. Write a clear one-sentence brand definition on your homepage (e.g. 'OptiAISEO is a Generative Engine Optimization platform that...'). 9. Create a dedicated /methodology page explaining your approach. 10. Publish definitions for your core category terms (what is GEO, what is AEO, etc.) — these become citation sources. 11. Use numbered lists and clear headings — AI models extract structured information more reliably. 12. Include named statistics with sources. 13. Write content at a reading level of grade 8-10 — simpler language is cited more frequently.",
      },
      {
        heading: "Entity and authority building",
        body: "14. Claim your Wikidata entry if your brand qualifies. 15. Get listed on G2, Capterra, and Product Hunt — these are high-trust sources AI models index heavily. 16. Submit to SaaS directories and niche industry lists. 17. Get your brand mentioned on authoritative blogs in your category (guest posts, interviews, tools roundups). 18. Ensure consistent brand name across all platforms — inconsistency confuses entity resolution.",
      },
      {
        heading: "Monitoring and iteration",
        body: "19. Run weekly manual prompts testing your category keywords in ChatGPT, Claude, and Perplexity. 20. Log citation rates in a spreadsheet or use OptiAISEO's automated gSOV tracking. 21. When competitors appear and you don't, analyse their content structure and schema. 22. Re-audit your schema quarterly — AI models update frequently and new schema types gain weight. 23. Track your Generative Share of Voice monthly and benchmark against 3 direct competitors.",
      },
    ],
    faqs: [
      { q: "What is Generative Engine Optimization?", a: "Generative Engine Optimization (GEO) is the practice of optimizing websites and content to appear in AI-generated answers from systems like ChatGPT, Claude, Perplexity, and Google AI Overviews — as opposed to traditional SEO which targets blue-link search results." },
      { q: "Is GEO different from AEO?", a: "GEO and AEO overlap significantly. AEO (Answer Engine Optimization) originally referred to optimizing for featured snippets and voice search. GEO is the newer term specifically covering AI-generated responses. In practice, the same techniques apply to both." },
      { q: "How do I know if my GEO is working?", a: "Track your Generative Share of Voice (gSOV) — the percentage of relevant AI responses that mention your brand. OptiAISEO automates this measurement weekly across ChatGPT, Claude, and Perplexity." },
    ],
    cta: "Run a free GEO audit on your site",
    related: [
      { href: "/geo", label: "Full GEO Guide" },
      { href: "/aeo", label: "AEO Guide" },
      { href: "/guide/how-to-rank-in-chatgpt", label: "How to rank in ChatGPT" },
      { href: "/free/gso-checker", label: "Free AI visibility checker" },
    ],
  },

  "aeo-vs-seo-difference": {
    title: "AEO vs SEO: What's the Difference in 2026? | OptiAISEO",
    description: "AEO vs SEO explained clearly. Learn the key differences, which one to prioritize, and how to run both strategies in 2026 without doubling your workload.",
    h1: "AEO vs SEO: The Complete Difference Explained (2026)",
    intro: "Search Engine Optimization (SEO) gets you ranked on Google. Answer Engine Optimization (AEO) gets you cited by AI. In 2026, you need both — but the strategies are different. This guide explains exactly how they differ and how to run them simultaneously.",
    sections: [
      {
        heading: "What is SEO?",
        body: "Search Engine Optimization is the practice of improving a website's visibility in traditional search engines like Google and Bing. It involves on-page optimization (titles, headings, content), technical optimization (page speed, schema, crawlability), and off-page signals (backlinks, brand mentions). The outcome: your page appears in blue-link results when someone searches a keyword.",
      },
      {
        heading: "What is AEO?",
        body: "Answer Engine Optimization is the practice of structuring content so that AI systems — ChatGPT, Claude, Perplexity, Google AI Overviews — cite your brand in their responses. Unlike SEO, AEO doesn't optimize for a ranking position. It optimizes for citation frequency. The outcome: when someone asks an AI 'what's the best tool for X?', your brand appears in the answer.",
      },
      {
        heading: "The 5 key differences",
        body: "1. Target system: SEO targets Google's algorithm. AEO targets AI language models. 2. Success metric: SEO measures rank position and organic clicks. AEO measures Generative Share of Voice (gSOV). 3. Content format: SEO rewards long-form comprehensive content. AEO rewards structured, factual, citable content. 4. Backlinks: Critical for SEO. Useful but secondary for AEO — entity authority matters more. 5. Speed: SEO results take 3-6 months. AEO citation rates can shift within weeks when schema and entity signals improve.",
      },
      {
        heading: "What they share",
        body: "Fortunately, good SEO and good AEO overlap on the fundamentals: factual content, fast page speed, proper schema markup, and trusted domain authority all help both. The biggest joint win is structured data — a well-implemented FAQ schema page ranks better on Google and gets cited more by AI. You don't need a separate content strategy for each.",
      },
    ],
    faqs: [
      { q: "Should I do SEO or AEO first?", a: "Do SEO first. SEO builds domain authority, which feeds into AEO citation rates. Once you have basic SEO in place (technical health, 10+ published pages, some backlinks), layer AEO on top with schema and entity optimization." },
      { q: "Will AI replace Google search?", a: "Unlikely in the short term. Google still handles 8+ billion searches per day. AI answers are growing fast but currently complement rather than replace traditional search. Plan for both." },
      { q: "What tools do both SEO and AEO?", a: "Most traditional SEO tools (Ahrefs, Semrush) don't do AEO at all. OptiAISEO is one of the few platforms that handles both: technical SEO audits and automated fixes alongside AI citation tracking and gSOV measurement." },
    ],
    cta: "Check your AEO and SEO scores free",
    related: [
      { href: "/aeo", label: "Full AEO Guide" },
      { href: "/seo", label: "SEO Guide" },
      { href: "/guide/how-to-rank-in-chatgpt", label: "How to rank in ChatGPT" },
      { href: "/vs", label: "Tool comparisons" },
    ],
  },

  "technical-seo-checklist-2026": {
    title: "Technical SEO Checklist 2026 — 40 Fixes That Move Rankings | OptiAISEO",
    description: "Complete technical SEO checklist for 2026. 40 actionable fixes covering Core Web Vitals, schema, crawlability, and indexing. Run a free audit to find your gaps.",
    h1: "Technical SEO Checklist 2026 — 40 Fixes That Move Rankings",
    intro: "Technical SEO is the foundation that determines whether your content can rank at all. No amount of great writing helps if Google can't crawl, index, and understand your pages. This checklist covers every technical issue that affects rankings in 2026, ordered by impact.",
    sections: [
      {
        heading: "Crawling and indexing (highest impact)",
        body: "1. Verify your robots.txt isn't blocking important pages. 2. Submit an XML sitemap to Google Search Console. 3. Ensure all canonical URLs are absolute and self-referencing. 4. Fix any noindex tags on pages you want indexed. 5. Resolve crawl errors in Google Search Console. 6. Eliminate redirect chains (A→B→C — collapse to A→C). 7. Fix broken internal links (404s from within your own site). 8. Ensure all pages are reachable within 3 clicks from the homepage.",
      },
      {
        heading: "Core Web Vitals",
        body: "9. Achieve LCP (Largest Contentful Paint) under 2.5 seconds. 10. Keep CLS (Cumulative Layout Shift) below 0.1. 11. Keep INP (Interaction to Next Paint) under 200ms. 12. Compress and lazy-load all images. 13. Serve images in WebP or AVIF format. 14. Eliminate render-blocking JavaScript. 15. Use a CDN for static assets.",
      },
      {
        heading: "Schema and structured data",
        body: "16. Add Organization schema to your homepage. 17. Add Article schema with datePublished to every blog post. 18. Add FAQPage schema to any page with Q&A content. 19. Add BreadcrumbList schema to all non-homepage pages. 20. Add Product or SoftwareApplication schema if you sell something. 21. Validate all schema with Google's Rich Results Test. 22. Fix any schema errors flagged in Search Console.",
      },
      {
        heading: "On-page technical",
        body: "23. Ensure every page has a unique, descriptive title tag under 60 characters. 24. Ensure every page has a unique meta description under 155 characters. 25. Use one H1 per page. 26. Add descriptive alt text to all meaningful images. 27. Ensure all internal links use descriptive anchor text. 28. Fix any duplicate content issues with canonical tags. 29. Implement hreflang if you serve multiple languages or regions.",
      },
    ],
    faqs: [
      { q: "How do I find my technical SEO issues?", a: "Run a site audit. OptiAISEO's free SEO checker scans your site in 60 seconds and identifies technical issues ranked by impact. You can also use Google Search Console's Coverage and Core Web Vitals reports." },
      { q: "How long does technical SEO take to show results?", a: "Technical fixes are the fastest-acting SEO changes. Critical fixes (crawl errors, indexing blocks) can show results in 2-4 weeks. Core Web Vitals improvements typically show ranking impact within 4-8 weeks." },
      { q: "What is the most important technical SEO factor in 2026?", a: "Core Web Vitals, particularly INP (Interaction to Next Paint), became a confirmed ranking signal in 2024. Combined with correct schema markup for AI search, these are the two highest-impact technical areas in 2026." },
    ],
    cta: "Run a free technical SEO audit",
    related: [
      { href: "/seo", label: "SEO Guide" },
      { href: "/free/seo-checker", label: "Free SEO checker" },
      { href: "/aeo", label: "AEO Guide" },
      { href: "/guide/aeo-vs-seo-difference", label: "AEO vs SEO" },
    ],
  },

  "what-is-generative-share-of-voice": {
    title: "What is Generative Share of Voice (gSOV)? | OptiAISEO",
    description: "Generative Share of Voice (gSOV) measures how often your brand is cited in AI-generated answers. Learn how to measure it, benchmark it, and grow it.",
    h1: "What is Generative Share of Voice (gSOV)?",
    intro: "Generative Share of Voice (gSOV) is the percentage of relevant AI-generated answers — from ChatGPT, Claude, Perplexity, and Google AI Overviews — that mention your brand. It's the AI-era equivalent of traditional Share of Voice in paid media: a measure of how much of the 'conversation' your brand owns.",
    sections: [
      {
        heading: "Why gSOV matters more than keyword rankings in 2026",
        body: "When someone asks ChatGPT 'what's the best tool for AI SEO?', they don't see 10 blue links — they see one answer. Whichever brand appears in that answer gets 100% of the intent. Keyword ranking position 1 on Google captures ~28% CTR. A citation in a ChatGPT answer can capture the entire decision. As AI answer usage grows, gSOV increasingly predicts brand consideration and pipeline.",
      },
      {
        heading: "How to calculate your gSOV",
        body: "Manual method: Define 10-20 category queries relevant to your product (e.g. 'best AI SEO tool', 'alternatives to Semrush', 'how to track AI citations'). Run each query in ChatGPT, Claude, and Perplexity. Log which brands appear in each answer. gSOV = (queries where your brand appears / total queries run) × 100. Automated method: OptiAISEO runs this measurement weekly across all three AI models and tracks your gSOV trend over time alongside competitor benchmarks.",
      },
      {
        heading: "What's a good gSOV score?",
        body: "Benchmarks vary by category competitiveness. Early-stage brands typically start at 0-5% gSOV. Category leaders in established markets typically achieve 30-60% gSOV. A realistic 6-month target for a new SaaS brand: reach 10-15% gSOV for your core category queries. The fastest way to improve: structured data, entity authority building, and publishing content that directly answers the queries you're tracking.",
      },
      {
        heading: "gSOV vs traditional Share of Voice",
        body: "Traditional Share of Voice measures brand presence in paid media (share of ad impressions in a category). Generative Share of Voice measures brand presence in AI-generated content. Unlike paid SOV, gSOV cannot be bought — it must be earned through content quality, entity authority, and schema signals. This makes it a more durable and defensible competitive advantage.",
      },
    ],
    faqs: [
      { q: "Is gSOV a Google metric?", a: "No. Google doesn't publish a gSOV metric. It was introduced by GEO researchers to quantify brand presence in AI-generated answers across all AI platforms including ChatGPT, Claude, Perplexity, and Google AI Overviews." },
      { q: "How often should I measure gSOV?", a: "Weekly tracking is recommended. AI model outputs shift as models are updated and as competitor content changes. Monthly tracking can miss significant swings. OptiAISEO automates weekly gSOV measurement." },
      { q: "What's the difference between gSOV and brand mentions?", a: "Brand mentions count any appearance of your brand name online. gSOV specifically measures citations in AI-generated answers to relevant category queries — a much more targeted and commercially meaningful signal." },
    ],
    cta: "Measure your gSOV free",
    related: [
      { href: "/free/gso-checker", label: "Free gSOV checker" },
      { href: "/geo", label: "GEO Guide" },
      { href: "/aeo", label: "AEO Guide" },
      { href: "/guide/how-to-rank-in-chatgpt", label: "How to rank in ChatGPT" },
    ],
  },

  // ── Trend-exploit pages (Google Trends: +750% robots.txt, SEO services rising) ──

  "robots-txt-ai-search": {
    title: "Robots.txt for AI Search: What You Must Change in 2026 | OptiAISEO",
    description: "Most sites are accidentally blocking AI crawlers like GPTBot and ClaudeBot. Learn exactly how to configure robots.txt for AI search engines — and what happens if you don't.",
    h1: "Robots.txt for AI Search: What You Must Change in 2026",
    intro: "Robots.txt was designed for Googlebot. But in 2026, dozens of AI crawlers index your site to train and retrieve content for ChatGPT, Perplexity, Claude, and Google's AI Overviews. Most sites haven't updated their robots.txt since AI crawlers emerged — and are silently blocking the very bots that decide whether they get cited. Here's how to fix it.",
    sections: [
      {
        heading: "Why robots.txt matters for AI search (and why most sites get it wrong)",
        body: "Traditional robots.txt guides teach you to allow Googlebot and optionally block scrapers. But since 2023, every major AI system has its own crawler: OpenAI uses GPTBot and ChatGPT-User, Anthropic uses ClaudeBot, Perplexity uses PerplexityBot, Meta uses Meta-ExternalAgent, Apple uses Applebot-Extended, and Google's AI systems use both Googlebot and Google-Extended. A misconfigured robots.txt — including a wildcard disallow (User-agent: * / Disallow: /) — blocks every one of these crawlers from reading and indexing your content. If AI crawlers can't read your site, you cannot appear in AI-generated answers. Period.",
      },
      {
        heading: "The AI crawlers you need to allow (2026 complete list)",
        body: "Add these explicit allow rules to your robots.txt to ensure full AI indexing coverage:\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: ChatGPT-User\nAllow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: anthropic-ai\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /\n\nUser-agent: Applebot-Extended\nAllow: /\n\nUser-agent: Meta-ExternalAgent\nAllow: /\n\nOnly restrict pages that genuinely shouldn't be indexed by AI: internal dashboards, checkout flows, admin routes, and private user data. Everything else should be accessible.",
      },
      {
        heading: "How robots.txt affects Google AI Overviews specifically",
        body: "Google's AI Overviews use two distinct crawlers: Googlebot (traditional) and Google-Extended (AI training and retrieval). If you've blocked Google-Extended in your robots.txt — intentionally or accidentally — your pages will still rank in blue-link results but won't appear in AI Overviews. This is a hidden indexing split that very few sites are aware of. To check: open your robots.txt and search for 'Google-Extended'. If you see 'Disallow: /', change it to 'Allow: /' immediately.",
      },
      {
        heading: "llms.txt — the emerging standard for AI-readable site maps",
        body: "Beyond robots.txt, a new standard called llms.txt is gaining traction. Modelled on robots.txt, it's a plain-text file at yourdomain.com/llms.txt that tells AI systems which pages are most important, what your site is about, and how your content is structured. Early adopters report improved citation rates because AI systems can prioritise their crawling more effectively. Format: a brief markdown file listing your key pages with one-line descriptions. OptiAISEO's AEO audit checks for llms.txt presence and helps you generate one.",
      },
      {
        heading: "How to audit your robots.txt for AI readiness (step by step)",
        body: "Step 1: Open yourdomain.com/robots.txt in a browser. Step 2: Look for any 'Disallow: /' rules under 'User-agent: *' — these block every crawler including AI bots. Step 3: Search for each AI crawler name listed above. If they're absent, they inherit the wildcard rules. Step 4: Add explicit 'Allow: /' rules for every AI crawler you want to index your site. Step 5: Re-validate using Google Search Console's robots.txt tester, and check your OptiAISEO AEO audit score — it now includes an AI crawler accessibility check.",
      },
    ],
    faqs: [
      { q: "Does blocking AI crawlers hurt my Google rankings?", a: "Blocking GPTBot and ClaudeBot doesn't directly affect Google blue-link rankings — Googlebot is separate. But blocking Google-Extended does prevent your content from appearing in Google AI Overviews, which is a growing traffic source." },
      { q: "Should I allow all AI crawlers to train on my content?", a: "This is a business decision. Allowing training crawlers (GPTBot with 'model-training' purpose) means your content may be used to train future AI models. Allowing retrieval crawlers (ChatGPT-User, PerplexityBot) means your content can be cited in real-time answers. Most SEO-focused sites allow both. Publishers with proprietary content sometimes restrict training but allow retrieval." },
      { q: "What is Google-Extended and should I allow it?", a: "Google-Extended is Google's crawler specifically for AI products and training. Blocking it prevents your content from appearing in Google AI Overviews and Google Bard/Gemini responses. Unless you have a specific legal reason to block it, allowing Google-Extended is strongly recommended for organic AI visibility." },
      { q: "How do I check if my robots.txt is blocking AI crawlers?", a: "Visit yourdomain.com/robots.txt and look for wildcard rules (User-agent: *) with Disallow: / or Disallow: rules covering your key pages. Then check whether GPTBot, ClaudeBot, and PerplexityBot appear with explicit Allow rules. OptiAISEO's AEO audit automates this check and flags any AI crawler blocks." },
    ],
    cta: "Audit your robots.txt for AI search",
    related: [
      { href: "/guide/generative-engine-optimization-checklist", label: "GEO checklist" },
      { href: "/guide/technical-seo-for-ai-search", label: "Technical SEO for AI search" },
      { href: "/aeo", label: "AEO Guide" },
      { href: "/free/seo-checker", label: "Free SEO audit" },
    ],
  },

  "technical-seo-for-ai-search": {
    title: "Technical SEO for AI Search Engines – 2026 Complete Guide | OptiAISEO",
    description: "Traditional technical SEO isn't enough for AI search. This guide covers the additional technical steps — schema, crawlability, llms.txt, and E-E-A-T signals — needed to rank in ChatGPT, Perplexity, and Google AI Overviews.",
    h1: "Technical SEO for AI Search Engines — 2026 Complete Guide",
    intro: "Technical SEO got your site into Google. But AI search engines have different infrastructure requirements — and most sites haven't updated for them. In 2026, winning in AI-generated answers requires a technical foundation that goes beyond Core Web Vitals and sitemaps. This guide covers every technical layer that determines your AI search visibility.",
    sections: [
      {
        heading: "Layer 1: Crawlability for AI bots (the foundation)",
        body: "Before any other optimization matters, AI crawlers must be able to read your site. Audit your robots.txt and ensure GPTBot, ClaudeBot, PerplexityBot, and Google-Extended are all permitted. Verify your sitemap.xml is submitted and up-to-date — AI crawlers use sitemaps exactly like Googlebot. Check that your Cloudflare, WAF, or CDN isn't rate-limiting or blocking known AI crawler user-agent strings. A site that AI crawlers can't index cannot appear in AI answers, regardless of content quality.",
      },
      {
        heading: "Layer 2: Schema markup — the language of AI systems",
        body: "Structured data is disproportionately important for AI search. AI systems parse JSON-LD to understand entity types, relationships, and content categories. Implement at minimum: Organization schema on every page (establishes your entity identity), Article schema with datePublished and dateModified on all content pages (freshness signals matter to AI models), FAQPage schema on any page with Q&A content (directly feeds into AI answer extraction), BreadcrumbList schema on all internal pages (helps AI understand site hierarchy). For SaaS: add SoftwareApplication schema with pricing and category. For e-commerce: add Product schema with offers. Validate everything with Google's Rich Results Test and fix all errors — broken schema is worse than no schema.",
      },
      {
        heading: "Layer 3: Entity authority infrastructure",
        body: "AI models understand entities — named things with defined relationships. Your brand needs to be a well-defined entity across the web. Technical actions: Add sameAs properties to your Organization schema pointing to your verified profiles (LinkedIn, Twitter/X, GitHub, Crunchbase, G2). Claim and verify your Google Business Profile if applicable. Create a /about page with explicit brand definition, founding date, and category. Create a /methodology page explaining your approach. These pages give AI crawlers consistent entity signals to associate your brand with your category.",
      },
      {
        heading: "Layer 4: Content structure for machine parsing",
        body: "AI systems extract answers from structured text. Your HTML must make this easy. Use semantic HTML5 elements: <article>, <section>, <header>, <main>, <aside>. Place the direct answer to the page's core question in the first 100 words — AI models extract the first clean answer they find. Use H2 and H3 tags as question formats ('What is X?', 'How does Y work?') — AI systems treat heading text as queries and the following paragraph as the answer. Use numbered and bulleted lists for multi-step or multi-item content — these are parsed and cited more reliably than prose paragraphs.",
      },
      {
        heading: "Layer 5: llms.txt — the emerging AI site map",
        body: "llms.txt is a new plain-text file standard (analogous to robots.txt) that tells AI systems which pages are most important and how your content is structured. Create a file at yourdomain.com/llms.txt containing: a one-paragraph brand description, your primary category definition, and a list of your most important pages with one-line descriptions. While not yet a confirmed ranking factor, early adopter data suggests AI systems use llms.txt to prioritise crawling — giving your key pages more citation weight. OptiAISEO's AEO audit checks for llms.txt and generates a starter file based on your site structure.",
      },
      {
        heading: "Layer 6: Performance and freshness signals",
        body: "Technical performance matters for AI search in two ways. First, slow pages are crawled less frequently — if AI crawlers time out on your pages, they use stale cached versions. Keep Time to First Byte (TTFB) under 600ms and ensure your server responds within 2 seconds globally. Second, freshness matters: AI models weight recently updated content more highly for time-sensitive queries. Add dateModified to your Article schema and update it whenever you make meaningful content changes. Use HTTP Last-Modified headers. Submit updated pages to Google Search Console's URL Inspection for faster re-indexing.",
      },
    ],
    faqs: [
      { q: "Is technical SEO different for AI search vs Google?", a: "It starts the same — crawlability, fast load times, and valid HTML are prerequisites for both. But AI search adds additional layers: schema markup is more critical, entity identity infrastructure matters more, content structure for machine extraction is a distinct requirement, and crawl permissions for AI-specific bots need explicit configuration." },
      { q: "What schema type has the biggest impact on AI search visibility?", a: "FAQPage schema has the highest direct impact on AI answer extraction — AI systems are specifically designed to pull from structured Q&A content. Organization schema is the most fundamental for entity recognition. Article schema with dateModified is critical for freshness signals in time-sensitive queries." },
      { q: "How do I know if AI crawlers are indexing my site?", a: "Check your server access logs for user-agent strings including GPTBot, ClaudeBot, PerplexityBot, and Google-Extended. You can also use OptiAISEO's AEO audit which tests your site's AI crawler accessibility and schema completeness as part of a single scan." },
      { q: "Does page speed affect AI search rankings?", a: "Indirectly, yes. Page speed affects how frequently and completely AI crawlers can index your pages. Slow or unavailable pages result in stale cached content being used for AI answers. As a general principle: anything that hurts Googlebot indexing also hurts AI crawler indexing." },
    ],
    cta: "Run a free AI search technical audit",
    related: [
      { href: "/guide/robots-txt-ai-search", label: "Robots.txt for AI crawlers" },
      { href: "/guide/generative-engine-optimization-checklist", label: "GEO checklist" },
      { href: "/guide/technical-seo-checklist-2026", label: "Technical SEO checklist" },
      { href: "/aeo", label: "AEO Guide" },
    ],
  },

  "seo-vs-aeo-vs-geo": {
    title: "SEO vs AEO vs GEO: The Complete 2026 Comparison | OptiAISEO",
    description: "SEO, AEO, and GEO — what's the difference and which one should you focus on? This complete guide explains all three strategies, how they overlap, and exactly how to run them together in 2026.",
    h1: "SEO vs AEO vs GEO: Full Comparison for 2026",
    intro: "Three acronyms dominate search marketing in 2026: SEO (Search Engine Optimization), AEO (Answer Engine Optimization), and GEO (Generative Engine Optimization). They sound similar, they overlap in some areas, and most guides confuse them with each other. This is the definitive comparison — what each one means, where they differ, and how to run all three without tripling your workload.",
    sections: [
      {
        heading: "SEO — optimizing for traditional search engines",
        body: "Search Engine Optimization is the practice of improving a website's visibility in traditional keyword-based search engines, primarily Google and Bing. It encompasses three domains: on-page optimization (title tags, headings, content relevance), technical optimization (crawlability, page speed, schema), and off-page signals (backlinks, brand mentions, domain authority). The output of successful SEO is a ranking position in the organic blue-link results. Success is measured by position, organic clicks, and impressions. Google still processes 8+ billion queries per day, making SEO the highest-volume channel in search marketing.",
      },
      {
        heading: "AEO — optimizing for AI answer engines",
        body: "Answer Engine Optimization is the practice of structuring content so that AI-powered answer engines — primarily voice assistants (Siri, Alexa), featured snippets, and now AI chatbots — cite your content as a direct answer. AEO predates the current AI search wave: it originally referred to optimizing for Siri, Google's Knowledge Panel, and featured snippets. In 2026, AEO has expanded to include ChatGPT, Claude, and Perplexity as answer surfaces. The key metric is citation frequency — how often your content is used as the source of an AI-generated answer. AEO doesn't optimize for a ranked position but for being the answer itself.",
      },
      {
        heading: "GEO — optimizing for generative AI search specifically",
        body: "Generative Engine Optimization is a refinement of AEO that specifically targets generative AI systems: ChatGPT Search, Perplexity, Google AI Overviews, Microsoft Copilot, and Gemini. Where AEO covers any answer engine (including non-AI systems like featured snippets), GEO focuses specifically on large language models and their retrieval pipelines. GEO tactics are more technical: entity graph optimization, llms.txt, AI crawler permissions, and structured data for LLM parsing. In practice, most teams treat AEO and GEO as interchangeable — the tactics overlap ~80%. The distinction matters most in enterprise contexts where teams have separate owners for different optimization channels.",
      },
      {
        heading: "Side-by-side comparison: SEO vs AEO vs GEO",
        body: "Target system — SEO: Google/Bing algorithm | AEO: AI answer engines broadly | GEO: LLMs specifically (ChatGPT, Perplexity, Google AIO). Primary metric — SEO: ranking position + organic clicks | AEO: citation rate + featured snippet share | GEO: Generative Share of Voice (gSOV). Content format — SEO: comprehensive long-form pages | AEO: structured Q&A, direct answers | GEO: entity-rich, machine-parseable, FAQ schema. Backlinks — SEO: critical | AEO: important | GEO: secondary to entity authority. Time to results — SEO: 3-6 months | AEO: 4-8 weeks | GEO: 2-6 weeks. Measurable today? — SEO: yes (GSC) | AEO: partially (GSC rich results) | GEO: yes with tools like OptiAISEO.",
      },
      {
        heading: "The unified strategy: run all three from one content workflow",
        body: "The good news: you don't need three separate content strategies. A single well-executed content piece can serve all three channels simultaneously. The formula: (1) Write comprehensive, factual content that answers specific questions directly — this serves SEO and AEO simultaneously. (2) Add FAQ schema and structured data — this amplifies AEO and GEO citation rates. (3) Build entity associations through consistent brand descriptions, directory listings, and third-party mentions — this improves GEO citation rates without any content duplication. The net result: your content investment compounds across all three channels rather than being split between them.",
      },
      {
        heading: "Which to prioritize in 2026 based on your stage",
        body: "Stage 1 (0-6 months, new site): Focus 80% on SEO fundamentals — technical health, content creation, initial backlinks. Layer in AEO schema on every page from day one (low cost, high future payoff). Stage 2 (6-18 months, growing site): Shift to 60% SEO, 40% AEO/GEO. Begin tracking gSOV. Optimize top-traffic pages for AI citation with FAQ schema and entity infrastructure. Stage 3 (18+ months, established site): Run all three in parallel with a unified team. SEO maintains rankings, AEO/GEO captures the growing AI answer layer. OptiAISEO handles technical AEO/GEO audits and gSOV tracking so you can run this workflow without adding headcount.",
      },
    ],
    faqs: [
      { q: "Is AEO the same as GEO?", a: "They overlap significantly. AEO (Answer Engine Optimization) covers any AI or machine answer system, including voice assistants and featured snippets. GEO (Generative Engine Optimization) specifically targets LLM-based generative AI systems like ChatGPT and Perplexity. In practice, the tactics are ~80% identical, and most teams treat them as synonymous." },
      { q: "Will AI search replace Google?", a: "Unlikely in the short term. Google still processes 8+ billion queries daily and has its own AI answer layer (AI Overviews). More likely: traditional blue-link results and AI answers coexist, with AI answers handling more informational queries and blue links handling commercial and navigational ones. Plan for both." },
      { q: "Do I need separate tools for SEO, AEO, and GEO?", a: "Traditional SEO tools (Ahrefs, Semrush) don't cover AEO or GEO. OptiAISEO is one of the few platforms handling all three: technical SEO audits, AEO schema generation, and GEO citation tracking (gSOV) in a single dashboard." },
      { q: "What's the fastest way to start with GEO if I already do SEO?", a: "Three actions with immediate impact: (1) Add FAQPage schema to your top 10 pages. (2) Check your robots.txt allows GPTBot, ClaudeBot, and PerplexityBot. (3) Create an llms.txt file at your domain root. These take less than a day to implement and improve AI crawler access immediately." },
    ],
    cta: "Check your SEO, AEO & GEO scores free",
    related: [
      { href: "/guide/robots-txt-ai-search", label: "Robots.txt for AI crawlers" },
      { href: "/guide/technical-seo-for-ai-search", label: "Technical SEO for AI search" },
      { href: "/guide/aeo-vs-seo-difference", label: "AEO vs SEO explained" },
      { href: "/aeo", label: "AEO platform" },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(GUIDES).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = GUIDES[slug];
  if (!guide) return { title: "Not Found" };
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `${SITE_URL}/guide/${slug}` },
    openGraph: {
      title: guide.title,
      description: guide.description,
      url: `${SITE_URL}/guide/${slug}`,
      type: "article",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = GUIDES[slug];
  if (!guide) notFound();

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.h1,
    description: guide.description,
    url: `${SITE_URL}/guide/${slug}`,
    datePublished: "2026-01-01",
    dateModified: new Date().toISOString().split("T")[0],
    author: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
    publisher: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: guide.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guide` },
      { "@type": "ListItem", position: 3, name: guide.h1, item: `${SITE_URL}/guide/${slug}` },
    ],
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      {/* Nav */}
      <nav className="w-full border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
              <span className="font-black text-background text-[11px] tracking-tight">AI</span>
            </div>
            <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground hidden sm:block transition-colors">Pricing</Link>
            <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Log in</Link>
            <Link href="/signup" className="text-sm font-semibold bg-foreground text-background px-4 py-2 rounded-full hover:opacity-90 transition-all">Try free →</Link>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 w-full">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex gap-2 text-sm text-muted-foreground mb-8">
          <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <Link href="/guide" className="hover:text-foreground transition-colors">Guides</Link>
          <span>/</span>
          <span className="text-foreground truncate">{guide.h1}</span>
        </nav>

        {/* Header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#10b981]/25 bg-[#10b981]/10 mb-4">
            <span className="text-xs font-semibold text-[#10b981] uppercase tracking-wider">Guide · Updated 2026</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-4 leading-tight">{guide.h1}</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">{guide.intro}</p>
        </div>

        {/* Sections */}
        <div className="space-y-10 mb-14">
          {guide.sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-xl font-bold mb-3">{s.heading}</h2>
              <p className="text-muted-foreground leading-relaxed text-base">{s.body}</p>
            </section>
          ))}
        </div>

        {/* CTA */}
        <div className="card-surface rounded-2xl p-8 text-center mb-14">
          <p className="text-sm text-muted-foreground mb-4">Ready to put this into practice?</p>
          <Link
            href="/free/seo-checker"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#10b981] text-white font-bold text-sm hover:opacity-90 transition-all"
          >
            {guide.cta} →
          </Link>
          <p className="text-xs text-muted-foreground mt-3">No account required</p>
        </div>

        {/* FAQs */}
        <section className="mb-14">
          <h2 id="faq-heading" className="text-2xl font-bold mb-6">Frequently asked questions</h2>
          <div className="space-y-3">
            {guide.faqs.map(({ q, a }) => (
              <details key={q} className="card-surface rounded-2xl group">
                <summary className="flex items-center justify-between px-6 py-5 cursor-pointer list-none font-semibold text-sm select-none">
                  <span>{q}</span>
                  <span className="text-muted-foreground ml-4 shrink-0 transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <div className="px-6 pb-6 text-sm text-muted-foreground leading-relaxed border-t border-border pt-4">{a}</div>
              </details>
            ))}
          </div>
        </section>

        {/* Related */}
        <section>
          <h2 className="text-base font-semibold mb-4 text-muted-foreground">Related guides</h2>
          <div className="flex flex-wrap gap-2">
            {guide.related.map(({ href, label }) => (
              <Link key={href} href={href} className="text-sm font-semibold px-4 py-2 rounded-full border border-border hover:border-[#10b981] hover:text-[#10b981] transition-colors">
                {label}
              </Link>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
