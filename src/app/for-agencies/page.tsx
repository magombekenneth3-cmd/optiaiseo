import type { Metadata } from "next";
import UseCasePage from "@/components/marketing/UseCasePage";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "White-Label SEO Platform for Agencies | OptiAISEO",
  description: "Manage unlimited client sites, generate white-label reports, auto-publish SEO fixes, and track AI citation scores — all from one dashboard. Start free.",
  alternates: { canonical: `${SITE_URL}/for-agencies` },
  openGraph: {
    title: "White-Label SEO Platform for Agencies | OptiAISEO",
    description: "Manage unlimited client sites, auto-publish fixes, white-label everything. Start free.",
    url: `${SITE_URL}/for-agencies`,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

const FOR_AGENCIES_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "White-Label SEO Platform for Agencies | OptiAISEO",
  "url": `${SITE_URL}/for-agencies`,
  "description": "Manage unlimited client sites, generate white-label reports, auto-publish SEO fixes, and track AI citation scores.",
  "speakable": {
    "@type": "SpeakableSpecification",
    "cssSelector": ["h1", "h2", "[data-speakable]"],
  },
  "breadcrumb": {
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL },
      { "@type": "ListItem", "position": 2, "name": "Solutions", "item": `${SITE_URL}/for-agencies` },
      { "@type": "ListItem", "position": 3, "name": "For Agencies", "item": `${SITE_URL}/for-agencies` },
    ],
  },
  "publisher": {
    "@type": "Organization",
    "name": "OptiAISEO",
    "url": SITE_URL,
    "logo": {
      "@type": "ImageObject",
      "url": `${SITE_URL}/favicon.ico`
    }
  },
  "about": {
    "@type": "Service",
    "name": "White-Label SEO & AEO Platform",
    "serviceType": "Digital Marketing Technology",
    "url": `${SITE_URL}/for-agencies`,
    "provider": {
      "@type": "Organization",
      "name": "OptiAISEO",
      "url": SITE_URL
    },
    "areaServed": { "@type": "Place", "name": "Global" },
    "offers": [
      { "@type": "Offer", "name": "Free Plan", "price": "0", "priceCurrency": "USD", "url": `${SITE_URL}/signup` },
      { "@type": "Offer", "name": "Pro Plan", "price": "49", "priceCurrency": "USD", "url": `${SITE_URL}/pricing` },
      { "@type": "Offer", "name": "Agency Plan", "price": "149", "priceCurrency": "USD", "url": `${SITE_URL}/pricing` }
    ]
  }
};

export default function ForAgenciesPage() {
  return (
    
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FOR_AGENCIES_SCHEMA) }} />
<UseCasePage
      eyebrow="For Growth Agencies"
      headline={"Manage 20 client sites.\nDeliver results on all of them.\nWithout hiring more people."}
      subheadline="OptiAISEO gives agencies a white-label SEO command center that audits every client site weekly, generates and publishes content fixes automatically, and delivers branded reports your clients will actually read."
      ctaLabel="Start your agency free trial"
      ctaHref="/signup?plan=agency"
      proofStats={[
        { value: "Unlimited", label: "sites on Agency plan" },
        { value: "White-label", label: "reports in your brand" },
        { value: "Auto-publish", label: "fixes — no dev handoff" },
      ]}
      problems={[
        {
          title: "You're drowning in audit reports nobody acts on",
          body: "You run the audit. You send the PDF. The client nods. Nothing gets fixed. Three months later, the rankings are the same and the client is asking why. The problem isn't the audit — it's the implementation gap.",
        },
        {
          title: "You need more output but can't scale headcount",
          body: "Every new client means more audits, more content briefs, more reports. You're billing for 10 clients but doing the work of 15. Your margins are shrinking. You need leverage, not more hires.",
        },
        {
          title: "Your clients are asking about AI search and you don't have a real answer",
          body: "\"Are we showing up in ChatGPT?\" Every client is asking this now. Most agency tools don't track it. You're guessing. Clients notice when you guess.",
        },
      ]}
      features={[
        {
          title: "Automated implementation, not just reporting",
          body: "When OptiAISEO finds an issue, it doesn't just log it. It writes the fix, generates the blog post, injects the schema, and pushes the GitHub PR. Your team reviews and approves. The client sees the result.",
        },
        {
          title: "White-label everything, including the AI scores",
          body: "Every report, every dashboard, every AEO score card carries your agency's brand. Clients see your logo, your colours, your domain. OptiAISEO is your engine, invisibly. The margin is entirely yours.",
        },
        {
          title: "AEO tracking built in — not a $199 add-on",
          body: "Track clients' AI citation scores across ChatGPT, Perplexity, Claude, and Google AI Overview. Show them before/after every month. No competitor agency tool does this at your price point.",
        },
      ]}
      workflowTitle="Your week with OptiAISEO"
      workflowSteps={[
        { day: "Monday", desc: "OptiAISEO runs weekly audits on all client sites automatically. No manual triggers needed from your team." },
        { day: "Tuesday", desc: "Issues flagged. For low-risk fixes (meta tags, schema, broken canonicals), fixes are written and queued automatically overnight." },
        { day: "Wednesday", desc: "You review the fix queue in one dashboard. Approve in one click per fix. Fixes publish to client CMS or GitHub." },
        { day: "Thursday", desc: "OptiAISEO emails each client their white-label weekly report. Issues found, fixes applied, ranking changes — branded as you." },
        { day: "Friday", desc: "You spend an hour on strategy across all clients. Zero hours on execution. That's the model." },
      ]}
      comparisonRows={[
        { feature: "Auto-implements fixes", us: "✓ Yes", them: "✗ No", theirLabel: "Ahrefs Advanced ($449/mo)" },
        { feature: "White-label reports", us: "✓ Included", them: "✗ Not available", theirLabel: "Ahrefs Advanced ($449/mo)" },
        { feature: "AI citation tracking", us: "✓ Included", them: "⚠ $199/mo add-on", theirLabel: "Ahrefs Advanced ($449/mo)" },
        { feature: "Blog auto-generation", us: "✓ Yes", them: "✗ No", theirLabel: "Ahrefs Advanced ($449/mo)" },
        { feature: "Unlimited sites", us: "✓ Yes", them: "✗ 50 projects max", theirLabel: "Ahrefs Advanced ($449/mo)" },
        { feature: "Price", us: "$149/month", them: "$449/month", theirLabel: "Ahrefs Advanced ($449/mo)" },
      ]}
      faqs={[
        { q: "Can clients log in to their own dashboard?", a: "Yes. Each client gets a read-only client portal view. They see their scores, their fixes, their rankings. You control what's visible." },
        { q: "How does auto-publishing work if a client uses WordPress?", a: "Connect their WordPress via our native plugin or REST API. Fixes and blog posts are submitted as drafts by default. You can switch to auto-publish for trusted clients." },
        { q: "Can I set different approval modes per client?", a: "Yes. Per-site operating mode: Report Only (just flags issues), Queue for Approval (you approve each fix), or Auto-Apply for trusted low-risk fixes." },
        { q: "How does white-label pricing work for reselling?", a: "Your Agency plan covers unlimited sites. What you charge your clients is entirely up to you. Most agencies mark up 50–150% and offer OptiAISEO as their proprietary AI SEO system." },
      ]}
      relatedLinks={[
        { href: "/for-saas", label: "For SaaS companies" },
        { href: "/for-content", label: "For content teams" },
        { href: "/for-ecommerce", label: "For e-commerce" },
        { href: "/vs/ahrefs", label: "OptiAISEO vs Ahrefs" },
        { href: "/pricing", label: "See Agency pricing" },
      ]}
    />
      </>
  );
}
