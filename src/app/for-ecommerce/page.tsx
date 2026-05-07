import type { Metadata } from "next";
import UseCasePage from "@/components/marketing/UseCasePage";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "AI SEO Platform for E-commerce Brands | OptiAISEO",
  description: "Audit every product page, auto-generate schema markup, track AI citations for your product category, and fix technical issues before they cost you rankings.",
  alternates: { canonical: `${SITE_URL}/for-ecommerce` },
  openGraph: {
    title: "AI SEO Platform for E-commerce Brands | OptiAISEO",
    description: "Product page audits at scale, auto-schema injection, AI shopping visibility tracking.",
    url: `${SITE_URL}/for-ecommerce`,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

const FOR_ECOMMERCE_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "AI SEO Platform for E-commerce Brands | OptiAISEO",
  "url": "https://optiaiseo.online/for-ecommerce",
  "description": "Audit every product page, auto-generate schema markup, track AI citations for your product category.",
  "publisher": {
    "@type": "Organization",
    "name": "OptiAISEO",
    "url": "https://optiaiseo.online",
    "logo": {
      "@type": "ImageObject",
      "url": "https://optiaiseo.online/logo.png"
    }
  },
  "about": {
    "@type": "Service",
    "name": "E-commerce AI SEO Auditing",
    "url": "https://optiaiseo.online/for-ecommerce",
    "provider": {
      "@type": "Organization",
      "name": "OptiAISEO",
      "url": "https://optiaiseo.online"
    },
    "offers": [
      { "@type": "Offer", "name": "Free Plan", "price": "0", "priceCurrency": "USD", "url": "https://optiaiseo.online/signup" },
      { "@type": "Offer", "name": "Pro Plan", "price": "49", "priceCurrency": "USD", "url": "https://optiaiseo.online/pricing" },
      { "@type": "Offer", "name": "Agency Plan", "price": "99", "priceCurrency": "USD", "url": "https://optiaiseo.online/pricing" }
    ]
  }
};

export default function ForEcommercePage() {
  return (
    
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FOR_ECOMMERCE_SCHEMA) }} />
<UseCasePage
      eyebrow="For E-commerce Brands"
      headline="Someone just asked ChatGPT for the best product in your category. Is your brand in the answer?"
      subheadline="OptiAISEO monitors how AI engines describe your product category, audits every product page for technical SEO, auto-generates schema markup, and fixes issues before they cost you rankings or conversions."
      ctaLabel="Audit my store free"
      ctaHref="/free/seo-checker"
      proofStats={[
        { value: "Bulk audit", label: "every product page" },
        { value: "Auto-inject", label: "Product & Review schema" },
        { value: "AI shopping", label: "visibility tracking" },
      ]}
      problems={[
        {
          title: "You have 500 product pages. You can audit 5.",
          body: "Manual SEO audits don't scale to e-commerce catalogues. Missing alt tags, thin descriptions, broken canonical tags, absent schema — multiplied across hundreds of pages. You find 10 and the other 490 stay broken.",
        },
        {
          title: "Your products don't appear in AI shopping recommendations",
          body: "When buyers ask ChatGPT \"what's the best [product],\" AI engines pull from structured data, review schemas, and brand authority signals — not your Google ranking. You need both now.",
        },
        {
          title: "Schema markup on product pages is technical and time-consuming",
          body: "Product schema, Review schema, Breadcrumb schema, Offer schema — each requires developer time to implement. When you update pricing or inventory, the schema goes stale. Nobody has time to maintain it.",
        },
      ]}
      features={[
        {
          title: "Bulk product page auditing",
          body: "Crawl your entire catalogue. Get a prioritised fix list sorted by potential traffic impact — not alphabetically. Missing schema flagged. Thin content identified. Duplicate titles caught. One run.",
        },
        {
          title: "Auto-generated product schema",
          body: "For every product page we crawl, we generate and inject the correct schema: Product, Offer, AggregateRating, and BreadcrumbList. Submit it via your CMS or as a GitHub PR. Updates automatically when prices change.",
        },
        {
          title: "AI shopping visibility tracking",
          body: "Track your brand's appearance in AI-generated shopping recommendations across ChatGPT, Perplexity, and Google AI Overview. See which competitors get cited instead of you — and what their pages have that yours don't.",
        },
      ]}
      workflowTitle="From broken product pages to AI-cited brand"
      workflowSteps={[
        { day: "Week 1", desc: "Connect your store. OptiAISEO crawls your entire product catalogue and produces a prioritised fix list ranked by revenue impact." },
        { day: "Week 2", desc: "Auto-generated Product schema submitted to your CMS or via GitHub PR. You review and merge. Schema live across all product pages." },
        { day: "Week 3", desc: "First AI visibility report: which queries trigger AI shopping recommendations? Which competitors appear? Where are your gaps?" },
        { day: "Ongoing", desc: "Weekly monitoring catches new issues (price changes breaking schema, new products without markup, thin content added). Auto-fixes queued for low-risk issues." },
      ]}
      comparisonRows={[
        { feature: "Bulk product page audit", us: "✓ Full catalogue scan", them: "✗ Manual page-by-page", theirLabel: "SEO Site Checkup ($109/mo)" },
        { feature: "Auto-schema injection", us: "✓ Product, Offer, Review, Breadcrumb", them: "✗ Not available", theirLabel: "SEO Site Checkup ($109/mo)" },
        { feature: "AI shopping visibility", us: "✓ ChatGPT, Perplexity, Google AI", them: "⚠ Basic monitoring", theirLabel: "SEO Site Checkup ($109/mo)" },
        { feature: "GitHub auto-fix PRs", us: "✓ Yes", them: "✗ No", theirLabel: "SEO Site Checkup ($109/mo)" },
        { feature: "Content generation", us: "✓ Category & buying guide content", them: "✗ Not available", theirLabel: "SEO Site Checkup ($109/mo)" },
        { feature: "Price", us: "$49/month Pro", them: "$109/month Professional", theirLabel: "SEO Site Checkup ($109/mo)" },
      ]}
      faqs={[
        { q: "Does it work with Shopify and WooCommerce?", a: "Yes. We crawl any public URL regardless of platform. For schema injection, we publish via GitHub PR for custom stores, or via WordPress API for WooCommerce. Shopify schema injection is via a code snippet we generate for your theme's liquid templates." },
        { q: "How do you handle products with variants (size, colour)?", a: "Each variant URL gets its own Product schema with the correct Offer markup for that specific variant's price and availability. If your variant URLs are parameterised rather than separate pages, we handle the canonical correctly." },
        { q: "How do you track AI shopping recommendations?", a: "We run weekly queries in ChatGPT, Perplexity, and Google AI simulating a buyer asking about your product category. We record whether your brand is mentioned, which competitors are cited, and what structured data signals appear to be driving those citations." },
        { q: "Can it monitor for price-change schema issues automatically?", a: "Yes. When we detect that a product page's visible price no longer matches its schema Offer price — which happens after promotions or repricing — we flag it and queue a schema update automatically." },
      ]}
      relatedLinks={[
        { href: "/for-agencies", label: "For agencies" },
        { href: "/for-saas", label: "For SaaS companies" },
        { href: "/for-content", label: "For content teams" },
        { href: "/vs/semrush", label: "OptiAISEO vs Semrush" },
        { href: "/free/seo-checker", label: "Free site audit" },
      ]}
    />
      </>
  );
}
