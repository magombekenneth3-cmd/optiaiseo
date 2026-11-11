export interface GuideItem {
  title: string;
  description: string;
  h1: string;
  intro: string;
  sections: { heading: string; body: string }[];
  faqs: { q: string; a: string }[];
  cta: string;
  related: { href: string; label: string }[];
}

export const GUIDES: Record<string, GuideItem> = {
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
      { href: "/aeo-guide/how-to-rank-in-chatgpt-search", label: "Rank in ChatGPT" },
      { href: "/guide/schema-markup-ai-search", label: "Schema markup guide" },
      { href: "/free/gso-checker", label: "Free gSOV checker" },
      { href: "/pricing", label: "OptiAISEO plans" },
    ],
  },

  "schema-markup-ai-search": {
    title: "Schema Markup for AI Search (ChatGPT & Perplexity) | OptiAISEO",
    description: "The complete guide to JSON-LD schema markup for AI search engines. Learn which schema types ChatGPT, Perplexity, and Google AI Overviews use to cite your brand.",
    h1: "Schema Markup for AI Search: Complete 2026 Implementation Guide",
    intro: "Schema markup was designed for search engines to understand page content. In 2026, it has become the primary mechanism by which AI models — ChatGPT, Perplexity, Claude, and Google AI Overviews — extract structured facts about your business, products, and content. This guide covers the essential schema types and how to implement them without code errors.",
    sections: [
      {
        heading: "Why schema markup matters more for AI than traditional Google",
        body: "Google can parse messy HTML with 25 years of heuristic refinement. AI models crawling with smaller compute budgets rely heavily on explicit structured data. When an AI crawler encounters a page with valid JSON-LD Organization, Product, and FAQPage schema, it can extract facts with 95%+ confidence. Without schema, it must infer meaning from raw text — which leads to hallucination, misclassification, or omission. Sites with comprehensive schema are cited 2.4x more frequently in AI answers than sites without.",
      },
      {
        heading: "1. Organization schema — the entity anchor",
        body: "Every domain needs Organization schema on its homepage and primary marketing pages. This tells AI models who you are, what category you operate in, and which external profiles represent you. Crucial properties: name, alternateName (all variations of your brand name), url, logo, description (your category definition), and sameAs (links to your Twitter, LinkedIn, GitHub, Crunchbase, and Wikipedia pages). The sameAs array is the single most important signal for AI entity resolution.",
      },
      {
        heading: "2. SoftwareApplication / Product schema — for SaaS and ecommerce",
        body: "If you sell software or products, AI models need structured pricing and feature data to answer commercial queries like 'best cheap SEO tool' or 'alternatives to Semrush under $50'. Required properties: name, applicationCategory (e.g. 'BusinessApplication'), operatingSystem ('Web'), description, offers (price, priceCurrency, availability), and featureList (array of specific capabilities). Without this schema, AI models will guess your pricing — often inaccurately.",
      },
      {
        heading: "3. FAQPage schema — the direct answer magnet",
        body: "FAQPage schema is the highest-leverage schema type for AI search citations. When a user asks an AI model a question, the model looks for direct question-and-answer pairs across trusted sources. By wrapping your Q&As in FAQPage JSON-LD, you format your answers in the exact structure AI models prefer to ingest. Implement 3–6 relevant, non-promotional FAQs on every key page.",
      },
      {
        heading: "4. Article schema with real dates — the freshness signal",
        body: "AI models heavily discount outdated information. Article schema tells AI crawlers when content was published and last updated. Crucial: always include both datePublished and dateModified in ISO-8601 format (YYYY-MM-DD). Do not fake dateModified — update it only when content actually changes. Also include author (Person with sameAs link) and publisher (Organization).",
      },
    ],
    faqs: [
      { q: "Can I use Microdata instead of JSON-LD for AI search?", a: "JSON-LD is strongly preferred. Google, OpenAI, Anthropic, and Perplexity all recommend JSON-LD because it's decoupled from the HTML structure and easier for headless crawlers to extract without rendering the full DOM." },
      { q: "How do I test my schema markup?", a: "Use Google's Rich Results Test (search.google.com/test/rich-results) and Schema.org's Validator (validator.schema.org). Both should return zero errors. OptiAISEO's free audit tool automatically validates schema on any URL." },
      { q: "Does schema markup guarantee AI citations?", a: "No. Schema makes your content machine-readable and citable, but AI models also evaluate domain authority, content accuracy, and entity prominence. Think of schema as a prerequisite — without it you're at a massive disadvantage, but you still need quality content." },
    ],
    cta: "Audit your schema markup free",
    related: [
      { href: "/aeo-guide/how-to-rank-in-chatgpt-search", label: "Rank in ChatGPT" },
      { href: "/guide/robots-txt-ai-search", label: "Robots.txt for AI crawlers" },
      { href: "/free/seo-checker", label: "Free technical SEO audit" },
      { href: "/aio", label: "AI SEO platform" },
    ],
  },

  "ai-citation-tracking": {
    title: "How to Track AI Search Citations & Mentions (2026) | OptiAISEO",
    description: "Learn how to track when ChatGPT, Perplexity, Claude, and Google AI Overviews cite your brand. Complete guide to measuring Generative Share of Voice (gSOV).",
    h1: "How to Track AI Citations in ChatGPT, Perplexity & Google AI (2026)",
    intro: "Traditional rank tracking tells you where you appear on Google's blue links. It tells you nothing about whether ChatGPT recommends your product, Perplexity cites your guide, or Google AI Overviews names your brand. This guide covers how to measure your AI search visibility using Generative Share of Voice (gSOV).",
    sections: [
      {
        heading: "The measurement gap: why traditional rank trackers fail for AI search",
        body: "Traditional rank trackers work by scraping Google SERP HTML and recording which pixel position your URL occupies. This model breaks down completely in AI search: AI models synthesize answers from multiple sources, don't display ranked lists of 10 links, and vary their responses based on prompt phrasing. You cannot measure AI search with a rank number. You need a probabilistic metric: across a representative sample of queries in your category, what percentage of AI answers cite your brand?",
      },
      {
        heading: "What is Generative Share of Voice (gSOV)?",
        body: "Generative Share of Voice (gSOV) is the percentage of relevant AI-generated responses that mention, cite, or recommend your brand or URL. A gSOV of 60% for 'best SEO tools for startups' means your brand appeared in 6 out of 10 AI responses across ChatGPT, Claude, and Perplexity for prompts matching that intent. It is the single most actionable KPI for Answer Engine Optimization.",
      },
      {
        heading: "How to build an initial gSOV benchmark manually",
        body: "Step 1: Identify your top 20 commercial queries (e.g. 'best [your category] for [your audience]', 'alternatives to [competitor]', 'how to solve [problem]'). Step 2: Run each prompt through ChatGPT (with web search enabled), Perplexity, and Claude. Step 3: Record whether your brand is mentioned, whether a source link is provided, and which competitors appear. Step 4: Calculate your citation rate: (mentions / total prompts) × 100. This is your baseline gSOV.",
      },
      {
        heading: "Automating AI citation tracking with OptiAISEO",
        body: "Manual tracking takes hours every week and produces noisy data because AI responses vary across sessions. OptiAISEO automates this: it runs scheduled multi-engine prompt batches weekly, tracks your gSOV trend over time, alerts you when a competitor overtakes your citation share, and identifies the exact source pages AI models are citing instead of yours.",
      },
    ],
    faqs: [
      { q: "How often should I check my AI citations?", a: "Weekly is ideal. Daily tracking produces too much statistical noise because LLM outputs are non-deterministic. Monthly is too slow to catch competitor campaigns. OptiAISEO runs weekly automated snapshots." },
      { q: "Which AI search engine matters most for citations?", a: "ChatGPT Search and Perplexity drive the highest volume of AI-assisted purchase decisions in 2026, followed by Google AI Overviews. Focus your initial AEO efforts on ChatGPT and Perplexity." },
      { q: "Can I improve my gSOV without paid tools?", a: "Yes. The highest-impact actions — adding FAQ schema, optimizing entity descriptions, publishing citable research, and fixing crawl errors — are free to implement. Tools like OptiAISEO save time on measurement and identify coverage gaps automatically." },
    ],
    cta: "Check your gSOV score free",
    related: [
      { href: "/free/gso-checker", label: "Free gSOV checker" },
      { href: "/aeo-guide/how-to-rank-in-chatgpt-search", label: "Rank in ChatGPT" },
      { href: "/guide/generative-engine-optimization-checklist", label: "GEO checklist" },
      { href: "/pricing", label: "OptiAISEO pricing" },
    ],
  },

  "robots-txt-ai-search": {
    title: "Robots.txt for AI Search: How to Allow or Block AI Crawlers | OptiAISEO",
    description: "Complete guide to robots.txt for AI search in 2026. Learn how to configure User-agent rules for GPTBot, ClaudeBot, PerplexityBot, and Google-Extended safely.",
    h1: "Robots.txt for AI Search: The Complete 2026 Guide to AI Crawlers",
    intro: "Every major AI company now runs dedicated web crawlers to train models and retrieve live search results. Your robots.txt file determines which AI models can read your content, which are blocked, and whether you appear in AI search results at all. This guide covers how each AI crawler works and how to configure them.",
    sections: [
      {
        heading: "The two types of AI crawlers: search vs training",
        body: "Understanding the distinction between search crawlers and training crawlers is critical. Search crawlers (ChatGPT User, PerplexityBot) fetch web pages in real-time when users ask questions. Blocking them means your content cannot appear in AI search answers. Training crawlers (GPTBot, ClaudeBot, Google-Extended) crawl the web to build future models. You can allow search crawlers while blocking training crawlers if you want AI search traffic without contributing to model training data.",
      },
      {
        heading: "Major AI crawler User-agent tokens in 2026",
        body: "OpenAI: GPTBot (training) and ChatGPT-User (real-time search). Anthropic: ClaudeBot (training) and Claude-Web (search). Perplexity: PerplexityBot (search and indexing). Google: Googlebot (all Google search, including AI Overviews) and Google-Extended (Gemini model training). Mistral: MistralBot. Cohere: cohere-ai. Apple: Applebot-Extended.",
      },
      {
        heading: "Recommended robots.txt configuration for maximum AI visibility",
        body: "If your goal is maximum traffic and citations from AI search engines: allow all search crawlers explicitly. At minimum: User-agent: GPTBot / Allow: / — User-agent: PerplexityBot / Allow: / — User-agent: ClaudeBot / Allow: / — User-agent: Googlebot / Allow: /. Always block private and authenticated paths: Disallow: /api/, Disallow: /dashboard/, Disallow: /admin/.",
      },
      {
        heading: "Common robots.txt mistakes that kill AI search visibility",
        body: "1. Blocking GPTBot thinking it only trains models — it also feeds ChatGPT Search retrieval in many configurations. 2. Forgetting that Google AI Overviews uses Googlebot, not Google-Extended — blocking Google-Extended does not stop Google AI Overviews from citing you. 3. Missing the Sitemap directive in robots.txt — AI crawlers use your sitemap to discover new content quickly. 4. Disallowing CSS/JS assets that AI headless browsers need to render page content.",
      },
    ],
    faqs: [
      { q: "Does blocking GPTBot remove my site from ChatGPT?", a: "It stops GPTBot from crawling your site for training and reduces your visibility in ChatGPT Search. If your content is already in the model's training weights, blocking GPTBot will not erase that historical knowledge immediately, but it prevents updates." },
      { q: "Can I block AI scrapers without hurting Google SEO?", a: "Yes. Google uses Googlebot for search ranking and Google-Extended for Gemini training. You can disallow Google-Extended in robots.txt without any impact on your traditional Google search rankings or Googlebot crawling." },
      { q: "Where should the Sitemap directive be in robots.txt?", a: "At the end of your robots.txt file: Sitemap: https://yourdomain.com/sitemap.xml. Use the full absolute URL including https://." },
    ],
    cta: "Audit your robots.txt with OptiAISEO",
    related: [
      { href: "/guide/schema-markup-ai-search", label: "Schema markup guide" },
      { href: "/aeo-guide/how-to-rank-in-chatgpt-search", label: "Rank in ChatGPT" },
      { href: "/free/seo-checker", label: "Free technical audit" },
      { href: "/security", label: "OptiAISEO security" },
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
      { href: "/aeo-guide/structured-data-for-ai-search", label: "Structured data for AI search" },
      { href: "/aeo-guide/answer-engine-optimization-vs-seo", label: "AEO vs SEO detailed breakdown" },
      { href: "/aeo", label: "AEO platform" },
    ],
  },
};
