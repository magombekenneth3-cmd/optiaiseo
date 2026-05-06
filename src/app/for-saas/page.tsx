import type { Metadata } from "next";
import UseCasePage from "@/components/marketing/UseCasePage";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "SEO & AI Visibility Platform for SaaS Companies | OptiAISEO",
  description: "Track how ChatGPT recommends your SaaS. Auto-generate comparison content. Fix technical issues without engineering tickets. Start free.",
  alternates: { canonical: `${SITE_URL}/for-saas` },
  openGraph: {
    title: "SEO & AI Visibility Platform for SaaS Companies | OptiAISEO",
    description: "Track AI citations, fix issues via GitHub PR, generate comparison content automatically.",
    url: `${SITE_URL}/for-saas`,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

const FOR_SAAS_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "SEO & AI Visibility Platform for SaaS Companies | OptiAISEO",
  "url": "https://www.optiaiseo.online/for-saas",
  "description": "Track how ChatGPT recommends your SaaS. Auto-generate comparison content. Fix technical issues without engineering tickets.",
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
    "name": "AI Visibility & SEO Automation for SaaS",
    "url": "https://www.optiaiseo.online/for-saas",
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

export default function ForSaaSPage() {
  return (
    
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FOR_SAAS_SCHEMA) }} />
<UseCasePage
      eyebrow="For SaaS Companies"
      headline="Prospects are asking ChatGPT which tool to use. Make sure the answer is yours."
      subheadline="OptiAISEO tracks your SaaS brand across every AI engine, generates comparison and use-case content automatically, and fixes technical SEO issues via GitHub PR — without a single engineering ticket."
      ctaLabel="Check my AI visibility now"
      ctaHref="/free/gso-checker"
      proofStats={[
        { value: "4 AI engines", label: "tracked continuously" },
        { value: "GitHub PR", label: "fixes — no Jira ticket" },
        { value: "Auto-generate", label: "comparison content" },
      ]}
      problems={[
        {
          title: "Your Google ranking doesn't protect you in AI search",
          body: "When someone asks ChatGPT \"best project management tool for startups,\" your Google position doesn't matter. The LLM makes its own call. You need to know what it says and why — before your prospects do.",
        },
        {
          title: "Your dev team can't prioritise SEO tickets",
          body: "You find the canonical issue. You write the Jira ticket. It sits for 6 weeks. By the time it's fixed, the page has lost 3 ranking positions. SEO can't wait for sprint cycles.",
        },
        {
          title: "Competitor comparison content converts at 3–5x your homepage rate",
          body: "\"Your tool vs Competitor\" pages are your best-converting traffic source. You know this. You're not producing enough of them because each one takes a full day to research and write properly.",
        },
      ]}
      features={[
        {
          title: "AI Citation Monitoring across all major LLMs",
          body: "Know what ChatGPT, Perplexity, Claude, and Google AI say about your product category before your prospects ask. Track share of voice against your top 5 competitors, weekly.",
        },
        {
          title: "GitHub PR fixes — no ticket, no sprint",
          body: "Broken canonical? Missing schema? Wrong meta on your pricing page? We detect it, open the PR with the exact code fix, and your engineer clicks merge. Average time from detection to PR: under 60 seconds.",
        },
        {
          title: "Comparison content at scale",
          body: "Feed us your competitor list. We generate SEO-optimised, fact-checked, schema-marked comparison pages and publish them to your CMS. One click to review and approve.",
        },
      ]}
      workflowTitle="Your SEO week — before and after"
      workflowSteps={[
        { day: "Before", desc: "Manual audits every quarter. SEO tickets competing with product features. Comparison content taking a day each to write. Zero visibility into AI search." },
        { day: "Monday", desc: "OptiAISEO's weekly audit runs automatically. AI citation scores updated. GitHub PRs queued for any new issues." },
        { day: "Tuesday", desc: "Your engineer gets a Slack notification: 3 PRs ready to merge. Total review time: 15 minutes. Issues fixed before end of day." },
        { day: "Wednesday", desc: "New comparison page drafted automatically based on this week's competitor tracking data. You review and publish." },
        { day: "Friday", desc: "Weekly AI visibility report sent to your team. GSoV score up 4 points this week. You know exactly which content change caused it." },
      ]}
      comparisonRows={[
        { feature: "AI citation tracking", us: "✓ Included in Pro", them: "✗ Not available", theirLabel: "Ahrefs ($249/mo)" },
        { feature: "GitHub auto-fix PRs", us: "✓ Yes", them: "✗ No", theirLabel: "Ahrefs ($249/mo)" },
        { feature: "Blog & comparison content generation", us: "✓ Yes", them: "✗ No", theirLabel: "Ahrefs ($249/mo)" },
        { feature: "GSC deep integration", us: "✓ Decay, gaps, cannibalization", them: "⚠ Basic keyword tracking", theirLabel: "Ahrefs ($249/mo)" },
        { feature: "Free tier", us: "✓ Generous — no card needed", them: "✗ No free trial", theirLabel: "Ahrefs ($249/mo)" },
        { feature: "Price", us: "$49/month Pro", them: "$249/month Standard", theirLabel: "Ahrefs ($249/mo)" },
      ]}
      faqs={[
        { q: "We already use Ahrefs. Why do we need OptiAISEO?", a: "Ahrefs tells you what's broken. We fix it and generate the content. They stop at the audit. We close the loop. Most SaaS teams use both: Ahrefs for deep keyword research, OptiAISEO for execution." },
        { q: "How accurate is the AI citation tracking?", a: "We run live queries across ChatGPT (GPT-4), Perplexity, Claude, and Google AI Overview weekly. We track whether your brand is mentioned, its position, competitor mentions, and full context. Live data, not estimates." },
        { q: "Can it integrate with our existing CMS?", a: "We natively support WordPress, Ghost, and Hashnode. For custom CMS setups, we publish via GitHub PR so your engineering team controls the merge." },
        { q: "What makes this different from hiring an SEO agency?", a: "An agency charges $3,000–10,000/month to do manually what OptiAISEO does automatically. We don't replace the strategy layer — we replace the execution layer." },
      ]}
      relatedLinks={[
        { href: "/for-agencies", label: "For agencies" },
        { href: "/for-content", label: "For content teams" },
        { href: "/for-ecommerce", label: "For e-commerce" },
        { href: "/vs/semrush", label: "OptiAISEO vs Semrush" },
        { href: "/free/gso-checker", label: "Free AI visibility check" },
      ]}
    />
      </>
  );
}
