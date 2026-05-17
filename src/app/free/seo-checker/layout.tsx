import type { Metadata } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Free SEO Checker — Instant Website Audit | OptiAISEO",
  description:
    "Run a free SEO audit on any website in under 2 minutes. Checks on-page SEO, technical issues, Core Web Vitals, schema errors, and content quality — with a prioritised fix list.",
  alternates: { canonical: `${SITE_URL}/free/seo-checker` },
  openGraph: {
    title: "Free SEO Checker — Instant Website Audit | OptiAISEO",
    description: "Run a free SEO audit on any website in under 2 minutes. No login required.",
    url: `${SITE_URL}/free/seo-checker`,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

const seoCheckerSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Free SEO Checker",
  url: `${SITE_URL}/free/seo-checker`,
  applicationCategory: "UtilityApplication",
  operatingSystem: "Web",
  description:
    "Instant, free SEO audit tool. Checks on-page SEO, technical issues, Core Web Vitals, schema errors, content quality, and provides a prioritised fix list. No login required.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "100% free — no account required",
  },
  provider: {
    "@type": "Organization",
    name: "OptiAISEO",
    url: SITE_URL,
  },
  featureList: [
    "On-page SEO analysis (title, meta, headings, images)",
    "Technical SEO checks (speed, mobile, crawlability)",
    "Content quality scoring (readability, keyword usage)",
    "Prioritised recommendation list with severity ratings",
    "Core Web Vitals assessment",
    "Schema markup validation",
  ],
};

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "Free Tools", item: `${SITE_URL}/free/seo-checker` },
    { "@type": "ListItem", position: 3, name: "SEO Checker", item: `${SITE_URL}/free/seo-checker` },
  ],
};

export default function SeoCheckerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(seoCheckerSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      {children}
    </>
  );
}
