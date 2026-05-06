import type { Metadata } from "next";
import UseCasePage from "@/components/marketing/UseCasePage";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "AI Content SEO Platform for Content Teams | OptiAISEO",
  description: "Stop writing SEO content from scratch. OptiAISEO finds keyword gaps, writes the article, optimises it for AI search, and publishes it automatically.",
  alternates: { canonical: `${SITE_URL}/for-content` },
  openGraph: {
    title: "AI Content SEO Platform for Content Teams | OptiAISEO",
    description: "Find keyword gaps, auto-generate articles, publish to CMS. Free tier available.",
    url: `${SITE_URL}/for-content`,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

const FOR_CONTENT_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "AI Content SEO Platform for Content Teams | OptiAISEO",
  "url": "https://www.optiaiseo.online/for-content",
  "description": "Find keyword gaps, auto-generate SEO articles, and publish them directly to your CMS with OptiAISEO.",
  "publisher": {
    "@type": "Organization",
    "name": "OptiAISEO",
    "url": "https://www.optiaiseo.online",
    "logo": {
      "@type": "ImageObject",
      "url": "https://www.optiaiseo.online/logo.png"
    }
  },
  "about": {
    "@type": "Service",
    "name": "AI-Powered Content SEO Platform",
    "url": "https://www.optiaiseo.online/for-content",
    "provider": {
      "@type": "Organization",
      "name": "OptiAISEO",
      "url": "https://www.optiaiseo.online"
    },
    "offers": [
      { "@type": "Offer", "name": "Free Plan", "price": "0", "priceCurrency": "USD", "url": "https://www.optiaiseo.online/signup" },
      { "@type": "Offer", "name": "Pro Plan", "price": "49", "priceCurrency": "USD", "url": "https://www.optiaiseo.online/pricing" },
      { "@type": "Offer", "name": "Agency Plan", "price": "99", "priceCurrency": "USD", "url": "https://www.optiaiseo.online/pricing" }
    ]
  }
};

export default function ForContentPage() {
  return (
    
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FOR_CONTENT_SCHEMA) }} />
<UseCasePage
      eyebrow="For Content Teams"
      headline="You have 847 keywords to target. Time to write 3 articles this week. We'll handle the other 844."
      subheadline="OptiAISEO finds keyword gaps in your GSC data, writes SEO-optimised long-form content that ranks in Google and gets cited by AI engines, and publishes it to your CMS automatically. On brand. Fact-checked. Every week."
      ctaLabel="Generate my first article free"
      ctaHref="/signup"
      proofStats={[
        { value: "GSC-powered", label: "keyword gap detection" },
        { value: "Auto-publish", label: "to WordPress, Ghost, Hashnode" },
        { value: "AEO-optimised", label: "schema on every post" },
      ]}
      problems={[
        {
          title: "Content decay is killing your existing rankings",
          body: "Your best articles from 2022 are slowly losing positions. You don't have time to monitor all of them. By the time you notice the traffic drop, you've already lost the ranking to a fresher competitor page.",
        },
        {
          title: "You're creating content that ranks on Google but gets ignored by AI search",
          body: "Your editorial team writes great content. LLMs don't cite it. They cite your competitor's thinner, more structured pages because they're formatted for AI comprehension. Different rules apply.",
        },
        {
          title: "Every new article takes 4 hours of research before you write a word",
          body: "SERP analysis. Competitor review. Outline. Brief. Draft. Edit. Optimise. Publish. That's a full day per article for a good writer. You need 10 articles a week. The maths don't work.",
        },
      ]}
      features={[
        {
          title: "Content decay detection and auto-refresh",
          body: "We monitor every page in your GSC data. When a page starts losing clicks or impressions, we flag it, diagnose why, rewrite the weakest sections, and republish. Your old content keeps ranking.",
        },
        {
          title: "GSC gap-to-article pipeline",
          body: "Connect your Google Search Console. We find keywords where you're ranking position 4–15 — almost there, not quite. We write the article that closes the gap. You review and publish. No briefing doc needed.",
        },
        {
          title: "AEO-optimised formatting on every post",
          body: "Every article includes a direct-answer opening paragraph (for Featured Snippets), an FAQ section with schema markup (for PAA boxes), and structured data automatically selected for the page type.",
        },
      ]}
      workflowTitle="Your content week — before and after OptiAISEO"
      workflowSteps={[
        { day: "Before", desc: "Brief 3 articles (2 hrs) · Write article 1 (4 hrs) · Write article 2 (4 hrs) · Write article 3 (4 hrs) · Edit and publish (3 hrs). Output: 3 articles, 17 hours of work." },
        { day: "Monday", desc: "Review OptiAISEO's weekly keyword gap report (30 mins). Approve 10 article outlines with one-click (30 mins)." },
        { day: "Tuesday", desc: "Review 10 drafted articles from overnight generation (2 hrs). Add proprietary insights and brand voice (2 hrs)." },
        { day: "Wednesday", desc: "Approve the publish queue. Articles go live automatically. (30 mins)." },
        { day: "Thur–Fri", desc: "Strategy work only — topic priorities, brand positioning, campaign planning. Output: 10 articles, 5 hours of work." },
      ]}
      comparisonRows={[
        { feature: "Generates content automatically", us: "✓ Yes", them: "✗ Grades content you write", theirLabel: "Surfer SEO ($99/mo)" },
        { feature: "Publishes to CMS", us: "✓ WordPress, Ghost, Hashnode", them: "✗ Manual export only", theirLabel: "Surfer SEO ($99/mo)" },
        { feature: "Content decay detection", us: "✓ GSC-powered monitoring", them: "✗ Not available", theirLabel: "Surfer SEO ($99/mo)" },
        { feature: "AI citation tracking", us: "✓ ChatGPT, Claude, Perplexity, Google", them: "✗ Not available", theirLabel: "Surfer SEO ($99/mo)" },
        { feature: "Technical SEO auditing", us: "✓ Full audit included", them: "✗ Content-only tool", theirLabel: "Surfer SEO ($99/mo)" },
        { feature: "Price", us: "$49/month Pro (unlimited posts)", them: "$99/month", theirLabel: "Surfer SEO ($99/mo)" },
      ]}
      faqs={[
        { q: "Will the AI content sound like us?", a: "You set the brand tone (Authoritative, Conversational, Technical, etc.) and provide your author profile in settings. Every post is generated in that voice. The 30-minute editorial review step is where you add the proprietary insights and stories that make it unmistakably yours." },
        { q: "How does the GSC keyword gap detection work?", a: "We pull your GSC data and identify keywords where you rank position 4–15 with meaningful impressions — the 'almost there' opportunities. These have proven search demand and proven you're relevant; you just need a better page. We generate that page." },
        { q: "Can we review everything before it goes live?", a: "Yes. The default mode is 'Queue for Approval' — every piece goes into a review queue for you to read, edit, and approve before publishing. You can switch to auto-publish for routine updates like content refreshes." },
        { q: "Does it work on our existing CMS?", a: "We natively support WordPress (via our plugin or REST API), Ghost, and Hashnode. For other CMSes, content is delivered as Markdown via GitHub PR so your team controls deployment." },
      ]}
      relatedLinks={[
        { href: "/for-agencies", label: "For agencies" },
        { href: "/for-saas", label: "For SaaS companies" },
        { href: "/for-ecommerce", label: "For e-commerce" },
        { href: "/vs/surfer-seo", label: "OptiAISEO vs Surfer SEO" },
        { href: "/blog", label: "Read our SEO blog" },
      ]}
    />
      </>
  );
}
