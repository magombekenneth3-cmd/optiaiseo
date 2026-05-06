import type { Metadata } from "next";
import HomeClient from "@/components/home/HomeClient";
import { getPublicStats } from "@/app/actions/stats";


// Stats are cached via unstable_cache (1h TTL) in src/app/actions/stats.ts

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");


const PAGE_TITLE = "OptiAISEO — AI SEO Platform That Fixes Itself | Free Trial";
const PAGE_DESC = "The AI SEO platform that tracks your brand in ChatGPT, Claude & Perplexity — and auto-fixes issues while you sleep. Start free today.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESC,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    siteName: "OptiAISEO",
    title: PAGE_TITLE,
    description: PAGE_DESC,
    type: "website",
    url: "/",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "OptiAISEO — Autonomous AEO & SEO Dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESC,
    images: ["/og-image.png"],
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "OptiAISEO",
  url: SITE_URL,
  logo: `${SITE_URL}/favicon.ico`,
  description:
    "OptiAISEO is an AI-powered Generative Engine Optimization (GEO) and Answer Engine Optimization (AEO) platform that helps brands get cited in ChatGPT, Claude, Perplexity, and Google AI Overviews. It automates technical SEO audits, schema injection, AI-optimised blog generation, and brand citation tracking.",
  // 'industry' is a non-standard extension understood by many LLMs when processing structured data
  industry: [
    "Artificial Intelligence Services",
    "Generative Engine Optimization",
    "Answer Engine Optimization",
    "Search Engine Optimization Software",
    "Digital Marketing Technology",
  ],
  areaServed: {
    "@type": "Place",
    name: "Global",
  },
  sameAs: [
    "https://twitter.com/aiseoseo",
    "https://linkedin.com/company/aiseoseo",
    "https://youtube.com/@aiseoseo",
    "https://instagram.com/aiseoseo",
    "https://facebook.com/aiseoseo",
  ],
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "support@optiaiseo.online",
    availableLanguage: "English",
  },
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "OptiAISEO",
  url: SITE_URL,
  description: "Autonomous AEO & AI SEO platform — get your brand cited in ChatGPT, Claude, and Perplexity.",
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE_URL}/blog?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

const webPageSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Free SEO Audit Tool — AI Website SEO Checker | OptiAISEO",
  description: "Run a free SEO audit on any website. OptiAISEO checks technical SEO, Core Web Vitals, schema errors, on-page issues, and competitor keyword gaps — then auto-generates code fixes.",
  url: SITE_URL,
  datePublished: "2024-01-01",
  dateModified: new Date().toISOString().split("T")[0],
  speakable: {
    "@type": "SpeakableSpecification",
    cssSelector: ["#aiseo-definition", "#faq-heading"],
  },
  breadcrumb: {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    ],
  },
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "OptiAISEO",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  offers: [
    { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Free Plan", description: "5 SEO audits/month, 1 site, 3 AEO checks/month, 50 credits" },
    { "@type": "Offer", price: "19", priceCurrency: "USD", name: "Starter Plan", billingIncrement: "P1M", description: "15 audits, 3 sites, 10 AEO checks, rank tracking, 150 credits/month" },
    { "@type": "Offer", price: "49", priceCurrency: "USD", name: "Pro Plan", billingIncrement: "P1M", description: "50 audits, 10 sites, 50 AEO checks, Ahrefs integration, GitHub auto-fix, 500 credits/month" },
    { "@type": "Offer", price: "149", priceCurrency: "USD", name: "Agency Plan", billingIncrement: "P1M", description: "Unlimited audits, sites, AEO checks, white-label exports, client portal, 2000 credits/month" },
  ],
};

// Explicit Service schema — AI models cite sites that clearly state what they offer
const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "AI SEO & AEO Optimization Platform",
  description:
    "OptiAISEO provides Generative Engine Optimization (GEO), Answer Engine Optimization (AEO), technical SEO auditing, AI-powered blog generation, schema injection, brand citation tracking, and competitor gap analysis — all in one autonomous platform.",
  serviceType: "Digital Marketing Technology",
  provider: {
    "@type": "Organization",
    name: "OptiAISEO",
    url: SITE_URL,
  },
  areaServed: {
    "@type": "Place",
    name: "Global",
  },
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "OptiAISEO Services",
    itemListElement: [
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Generative Engine Optimization (GEO)",
          description: "Optimize your website to appear in AI-generated answers from ChatGPT, Claude, Perplexity, and Google AI Overviews.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Answer Engine Optimization (AEO)",
          description: "Structured data and entity optimization to get your brand directly cited when users ask questions of AI assistants.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Automated Technical SEO Audit",
          description: "Full crawl-based technical audit covering Core Web Vitals, schema errors, broken links, and content gaps — with auto-generated GitHub PR fixes.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "AI Blog & Content Generation",
          description: "Entity-dense, schema-annotated long-form blog posts generated by AI, optimised for AI Overview inclusion and topical authority.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Brand Citation & AI Visibility Tracking",
          description: "Daily tracking of your Generative Share of Voice (gSOV) — how often your brand is cited across ChatGPT, Claude, Perplexity, and Google AI.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Competitor Gap Analysis",
          description: "Identify keywords, topics, and backlinks your competitors rank for that your site does not, and auto-generate content to close the gap.",
        },
      },
    ],
  },
};

const faqItems = [
  {
    name: "What is OptiAISEO and how does it work?",
    acceptedAnswer: {
      text: "OptiAISEO is an autonomous Answer Engine Optimization (AEO) platform. It scans your website for technical issues, automatically opens GitHub Pull Requests to fix code, and generates entity-dense AI blog content.",
    },
  },
  {
    name: "What is generative share of voice?",
    acceptedAnswer: {
      text: "Generative Share of Voice (GSoV) measures how frequently your brand is cited by AI models like ChatGPT, Claude, and Perplexity. OptiAISEO tracks your GSoV daily and identifies citation gaps against your competitors.",
    },
  },
  {
    name: "How do I get my brand mentioned in ChatGPT?",
    acceptedAnswer: {
      text: "To rank in ChatGPT, you must optimize for Answer Engine Optimization (AEO). This requires implementing precise JSON-LD schema markup, building topical authority, and producing factual, entity-dense content.",
    },
  },
  {
    name: "What is the difference between SEO and AEO?",
    acceptedAnswer: {
      text: "Search Engine Optimization (SEO) focuses on ranking web pages in traditional search engines that provide blue links. Answer Engine Optimization (AEO) focuses on structuring data so your brand is directly cited by Generative AI models.",
    },
  },
  {
    name: "How does the GitHub auto-fix feature work?",
    acceptedAnswer: {
      text: "OptiAISEO analyzes your connected GitHub repository for SEO issues like missing schema or broken tags. It automatically generates the necessary code changes and creates a Pull Request for your engineering team.",
    },
  },
  {
    name: "How long does SEO take to show results?",
    acceptedAnswer: {
      text: "Honest answer: most sites see meaningful organic growth after 3–6 months of consistent work. SEO is not a one-time task — it compounds over time. Unlike paid ads that stop the moment you stop paying, rankings you earn through content, technical fixes, and backlinks can last for years. OptiAISEO accelerates the process by automating audits, schema fixes, and content generation so you build momentum faster.",
    },
  },
  {
    name: "How can I research what my competitors are ranking for?",
    acceptedAnswer: {
      text: "Your competitors' entire content strategy is publicly visible if you know where to look. OptiAISEO's competitor gap analysis shows you exactly which keywords they rank for that you don't, which topics they write about most, and which sites link to them but not to you. You can then use that intelligence to produce better content and target the same high-value opportunities — without guessing.",
    },
  },
  {
    name: "Do I need to set up my site before running an audit?",
    acceptedAnswer: {
      text: "Yes — OptiAISEO audits are tied to a verified site connection. Once you add your domain (takes under 2 minutes), your first audit is queued automatically. Free accounts include 5 audits per month after setup.",
    },
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.name,
    acceptedAnswer: { "@type": "Answer", text: item.acceptedAnswer.text },
  })),
};

export default async function Home() {
  const stats = await getPublicStats().catch(() => ({ siteCount: 0, weeklySignups: 0, auditCount: 0, blogCount: 0 }));
  try {
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
        <HomeClient faqItems={faqItems} stats={stats} />
      </>
    );
  } catch (err: unknown) {
    console.error("[Home] Server Component render failed:", err);
    throw err;
  }
}