import type { AeoGuideContent } from "./types";

export const content: AeoGuideContent = {
  slug: "how-to-rank-in-perplexity-ai",
  intro: "Perplexity AI has become the fastest-growing AI search engine, known for its real-time source citations and research-focused users. Ranking in Perplexity requires a different approach than Google — here's exactly how.",
  sections: [
    { heading: "How Perplexity AI Selects Sources", body: "Perplexity uses its own crawler (PerplexityBot) combined with Bing's index to retrieve content. It prioritizes sources based on relevance to the query, domain authority, content freshness, and structural clarity. Unlike Google AI Overviews, Perplexity always shows citations and often cites 4–6 sources per answer — meaning there are more opportunities to appear." },
    { heading: "Ensure PerplexityBot Can Crawl You", body: "Check your robots.txt to confirm PerplexityBot is not blocked. Per the locked classification in this project, PerplexityBot is explicitly allowed in robots.ts. Verify your pages are indexed in Bing, since Perplexity supplements its own index with Bing. Submit your sitemap to Bing Webmaster Tools if you haven't already." },
    { heading: "Write in Perplexity's Preferred Format", body: "Perplexity users skew toward research, technical, and professional queries. They expect precise, specific answers with sources. Write content that leads with the direct answer, cites data with sources inline (e.g., 'According to the 2026 HubSpot Marketing Report...'), and uses clear section breaks. Avoid marketing language — Perplexity's audience penalizes promotional tone." },
    { heading: "Include Data, Statistics, and Named Sources", body: "Perplexity citations heavily favor pages with specific, verifiable data. A page saying 'AI search is growing rapidly' will rarely be cited. A page saying 'AI search queries grew 340% year-over-year in 2026, per Semrush's search trends report' is highly citable. Make your content empirically grounded." },
    { heading: "Build Authority Through Consistency", body: "Perplexity's source selection rewards domains that consistently appear as high-quality sources across multiple queries in a topic area. Publish a cluster of well-sourced content on your core topic, not a single optimized page. Authority is domain-wide, not page-level, in Perplexity's ranking system." },
    { heading: "Monitor Perplexity Citations", body: "Manually search your top 10 target keywords in Perplexity monthly. Note whether your domain appears, which pages are cited, and which competitors dominate. OptiAISEO's AI Share of Voice tracker automates Perplexity citation monitoring across your full keyword set." },
  ],
  faqs: [
    { q: "Does Perplexity use Google or Bing for search?", a: "Perplexity uses a combination of its own crawler (PerplexityBot) and Bing's index. It does not rely on Google. This means your Bing visibility directly impacts your Perplexity citation rate." },
    { q: "Can I block Perplexity from crawling my site?", a: "Yes, by adding 'User-agent: PerplexityBot / Disallow: /' to your robots.txt. However, blocking Perplexity means losing citation opportunities in one of the fastest-growing AI search platforms. Most publishers choose to allow it." },
    { q: "Is Perplexity important enough to optimize for separately from Google?", a: "With 15+ million monthly active users and strong growth among professional and research-oriented demographics, Perplexity represents meaningful traffic potential. Its users tend to have higher intent and engagement than average search users, making citation there especially valuable." },
  ],
};
