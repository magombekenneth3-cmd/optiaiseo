import type { Metadata } from "next";
import HomeClient from "@/components/home/HomeClient";
import { getPublicStats } from "@/app/actions/stats";

// Stats are cached via unstable_cache (1h TTL) in src/app/actions/stats.ts

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online"
).replace(/\/$/, "");

const PAGE_TITLE = "OptiAISEO — AI SEO Platform That Fixes Itself | Free Trial";
const PAGE_DESC =
  "The AI SEO platform that tracks your brand in ChatGPT, Claude & Perplexity — and auto-fixes issues while you sleep. Start free today.";

const IDS = {
  organization: `${SITE_URL}/#organization`,
  website: `${SITE_URL}/#website`,
  webpage: `${SITE_URL}/#webpage`,
  software: `${SITE_URL}/#software`,
  service: `${SITE_URL}/#service`,
  video: `${SITE_URL}/#video`,
  faq: `${SITE_URL}/#faq`,
} as const;

/**
 * Keep this pointed at a real brand logo.
 *
 * Do NOT use favicon.ico as the Organization logo.
 * If /logo.png does not exist yet, either add it or remove
 * the logo properties until a real logo asset exists.
 */
const LOGO_URL = `${SITE_URL}/logo.png`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESC,
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    siteName: "OptiAISEO",
    title: PAGE_TITLE,
    description: PAGE_DESC,
    type: "website",
    url: SITE_URL,
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
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
    images: [`${SITE_URL}/og-image.png`],
  },
};

/**
 * Organization
 *
 * Keep this semantic rather than turning it into a keyword list.
 * "industry" should describe the organization's actual business,
 * not every product feature, tool, or SEO keyword it targets.
 */
const organizationSchema = {
  "@type": "Organization",
  "@id": IDS.organization,
  name: "OptiAISEO",
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    "@id": `${SITE_URL}/#logo`,
    url: LOGO_URL,
    contentUrl: LOGO_URL,
  },
  description:
    "OptiAISEO is an AI-powered SEO, Answer Engine Optimization (AEO), and Generative Engine Optimization (GEO) platform that helps brands improve search visibility and visibility across AI-powered search experiences.",
  industry: [
    "Artificial Intelligence",
    "Marketing Technology",
    "Digital Marketing",
    "Search Engine Optimization",
  ],
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

/**
 * WebSite
 *
 * SearchAction is intentionally omitted unless /blog?q= actually
 * performs a real search on the public website.
 */
const websiteSchema = {
  "@type": "WebSite",
  "@id": IDS.website,
  name: "OptiAISEO",
  url: SITE_URL,
  description:
    "Autonomous AEO and AI SEO platform for improving search visibility and brand citations across traditional and AI-powered search.",
  publisher: {
    "@id": IDS.organization,
  },
};

/**
 * SoftwareApplication
 *
 * This represents the actual OptiAISEO SaaS product.
 *
 * IMPORTANT:
 * Keep these offers synchronized with the canonical pricing
 * configuration used by the application.
 */
const softwareSchema = {
  "@type": "SoftwareApplication",
  "@id": IDS.software,
  name: "OptiAISEO",
  url: SITE_URL,
  description:
    "AI-powered SEO, AEO, and GEO software for technical SEO auditing, content optimization, search visibility analysis, and AI-search citation tracking.",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  publisher: {
    "@id": IDS.organization,
  },
  offers: [
    {
      "@type": "Offer",
      name: "Free Plan",
      price: "0",
      priceCurrency: "USD",
      url: `${SITE_URL}/pricing`,
      description:
        "5 SEO audits/month, 1 site, 3 AEO checks/month, 50 credits.",
      availability: "https://schema.org/InStock",
    },
    {
      "@type": "Offer",
      name: "Starter Plan",
      price: "19",
      priceCurrency: "USD",
      url: `${SITE_URL}/pricing`,
      billingDuration: "P1M",
      description:
        "15 audits, 3 sites, 10 AEO checks, rank tracking, and 150 credits/month.",
      availability: "https://schema.org/InStock",
    },
    {
      "@type": "Offer",
      name: "Pro Plan",
      price: "49",
      priceCurrency: "USD",
      url: `${SITE_URL}/pricing`,
      billingDuration: "P1M",
      description:
        "50 audits, 10 sites, 50 AEO checks, Ahrefs integration, GitHub auto-fix, and 500 credits/month.",
      availability: "https://schema.org/InStock",
    },
    {
      "@type": "Offer",
      name: "Agency Plan",
      price: "149",
      priceCurrency: "USD",
      url: `${SITE_URL}/pricing`,
      billingDuration: "P1M",
      description:
        "Unlimited audits, sites, and AEO checks, plus white-label exports, client portal, and 2000 credits/month.",
      availability: "https://schema.org/InStock",
    },
  ],
};

/**
 * Service
 *
 * This describes the commercial service/platform capabilities
 * without pretending each capability is a separate organization.
 */
const serviceSchema = {
  "@type": "Service",
  "@id": IDS.service,
  name: "OptiAISEO SEO, AEO & GEO Platform",
  url: SITE_URL,
  description:
    "OptiAISEO provides SEO, Answer Engine Optimization (AEO), Generative Engine Optimization (GEO), technical SEO auditing, content optimization, AI-powered content generation, brand citation tracking, and competitor analysis.",
  serviceType: "Search Engine Optimization",
  provider: {
    "@id": IDS.organization,
  },
  offers: {
    "@type": "Offer",
    url: `${SITE_URL}/pricing`,
  },
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "OptiAISEO Platform Capabilities",
    itemListElement: [
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Generative Engine Optimization (GEO)",
          description:
            "Optimize website content and entities for visibility in AI-generated search experiences.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Answer Engine Optimization (AEO)",
          description:
            "Optimize structured content and entities for answer engines and AI assistants.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Technical SEO Auditing",
          description:
            "Analyze technical SEO issues including crawlability, schema, broken links, and on-page problems.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "AI Content Optimization",
          description:
            "Optimize content for search visibility, topical relevance, and AI-powered search experiences.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "AI Content Generation",
          description:
            "Generate search-focused content designed to support topical authority and organic visibility.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Brand Citation Tracking",
          description:
            "Monitor brand visibility and citations across supported AI-powered search experiences.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Competitor Gap Analysis",
          description:
            "Identify search opportunities and content gaps relative to competitors.",
        },
      },
    ],
  },
};

/**
 * Homepage
 *
 * This is a WebPage, not an Article.
 *
 * There should only be a datePublished/dateModified here if these
 * dates represent real editorial/content lifecycle dates.
 */
const webPageSchema = {
  "@type": "WebPage",
  "@id": IDS.webpage,
  url: SITE_URL,
  name: PAGE_TITLE,
  description: PAGE_DESC,
  isPartOf: {
    "@id": IDS.website,
  },
  about: {
    "@id": IDS.software,
  },
  mainEntity: {
    "@id": IDS.software,
  },
  publisher: {
    "@id": IDS.organization,
  },
  speakable: {
    "@type": "SpeakableSpecification",
    cssSelector: [
      "#aiseo-definition",
      "#faq-heading",
      "#why-seo-important",
      "#how-google-works",
      "#seo-results-timeline",
    ],
  },
  breadcrumb: {
    "@type": "BreadcrumbList",
    "@id": `${SITE_URL}/#breadcrumb`,
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: SITE_URL,
      },
    ],
  },
};

/**
 * Single VideoObject
 *
 * This video is defined once and referenced from the graph.
 */
const videoSchema = {
  "@type": "VideoObject",
  "@id": IDS.video,
  name: "What is SEO? Search Engine Optimization Explained",
  description:
    "A visual explainer covering the fundamentals of SEO, how search engines work, why rankings matter, and how to optimize a website for search.",
  thumbnailUrl:
    "https://img.youtube.com/vi/MYE6T_gd7H0/hqdefault.jpg",
  uploadDate: "2024-01-01",
  contentUrl: "https://www.youtube.com/watch?v=MYE6T_gd7H0",
  embedUrl: "https://www.youtube.com/embed/MYE6T_gd7H0",
  publisher: {
    "@id": IDS.organization,
  },
};

/**
 * FAQ content.
 *
 * IMPORTANT:
 * Every answer must describe functionality that actually exists
 * in the current production product.
 */
const faqItems = [
  {
    name: "What is OptiAISEO and how does it work?",
    acceptedAnswer: {
      text: "OptiAISEO is an AI-powered SEO, Answer Engine Optimization (AEO), and Generative Engine Optimization (GEO) platform. It helps analyze websites, identify search optimization opportunities, optimize content, and monitor visibility across traditional and AI-powered search experiences.",
    },
  },
  {
    name: "What is generative share of voice?",
    acceptedAnswer: {
      text: "Generative Share of Voice (GSoV) measures how frequently a brand is mentioned or cited in supported AI-generated search experiences. OptiAISEO uses visibility data to help identify citation and competitive gaps.",
    },
  },
  {
    name: "How do I get my brand mentioned in ChatGPT?",
    acceptedAnswer: {
      text: "Improving visibility in AI-powered search requires strong technical SEO, authoritative and factual content, clear entity relationships, structured data where appropriate, and consistent topical authority. OptiAISEO provides tools designed to help identify and improve these areas.",
    },
  },
  {
    name: "What is the difference between SEO and AEO?",
    acceptedAnswer: {
      text: "Search Engine Optimization (SEO) focuses primarily on improving visibility in traditional search engines, while Answer Engine Optimization (AEO) focuses on structuring and optimizing information so it can be understood and surfaced by answer engines and AI-powered search experiences.",
    },
  },
  {
    name: "How does the GitHub auto-fix feature work?",
    acceptedAnswer: {
      text: "When GitHub auto-fix is available for your connected repository and an eligible SEO issue is identified, OptiAISEO can generate code changes and create a Pull Request for review.",
    },
  },
  {
    name: "How long does SEO take to show results?",
    acceptedAnswer: {
      text: "SEO results vary by website, competition, authority, content quality, technical condition, and the changes being implemented. Many businesses should expect SEO to require several months of consistent work rather than immediate results.",
    },
  },
  {
    name: "How can I research what my competitors are ranking for?",
    acceptedAnswer: {
      text: "Competitor analysis can reveal keywords, topics, content opportunities, and other search signals where competitors outperform your website. OptiAISEO provides competitor gap analysis capabilities to help identify these opportunities.",
    },
  },
  {
    name: "Do I need to set up my site before running an audit?",
    acceptedAnswer: {
      text: "Yes. An OptiAISEO audit requires a verified website connection. After the site is connected and setup is complete, eligible accounts can run audits according to the limits of their plan.",
    },
  },
];

const faqSchema = {
  "@type": "FAQPage",
  "@id": IDS.faq,
  url: SITE_URL,
  isPartOf: {
    "@id": IDS.website,
  },
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.name,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.acceptedAnswer.text,
    },
  })),
};

/**
 * One coherent Schema.org graph.
 *
 * Relationships:
 *
 * Organization
 *      ↓ publisher/provider
 * WebSite
 *      ↓ isPartOf
 * WebPage
 *      ↓ mainEntity/about
 * SoftwareApplication
 *
 * Organization
 *      ↓ provider
 * Service
 *
 * Organization
 *      ↓ publisher
 * VideoObject
 *
 * WebSite
 *      ↓
 * FAQPage
 */
const homePageJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    organizationSchema,
    websiteSchema,
    webPageSchema,
    softwareSchema,
    serviceSchema,
    videoSchema,
    faqSchema,
  ],
};

export default async function Home() {
  const stats = await getPublicStats().catch(() => ({
    siteCount: 0,
    weeklySignups: 0,
    auditCount: 0,
    blogCount: 0,
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homePageJsonLd),
        }}
      />

      <HomeClient faqItems={faqItems} stats={stats} />
    </>
  );
}