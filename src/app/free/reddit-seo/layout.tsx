import { CANONICAL_SITE_URL } from "@/lib/canonical";
import { Metadata } from "next";

const SITE_URL = CANONICAL_SITE_URL;

export const metadata: Metadata = {
  title: "Free Reddit SEO Tool — Find Threads Ranking on Google",
  description:
    "Find Reddit threads ranking on Google's first page for your keywords. Join the conversation, get referral traffic, and build brand signals for AI search. Free, no login.",
  alternates: {
    canonical: `${SITE_URL}/free/reddit-seo`,
  },
  openGraph: {
    title: "Free Reddit SEO Tool — Find Threads Ranking on Google",
    description:
      "Find Reddit threads ranking on Google's first page for your keywords. Join the conversation, get referral traffic, and build brand signals for AI search. Free, no login.",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO Free Reddit SEO Tool" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Reddit SEO Tool — Find Threads Ranking on Google",
    description:
      "Find Reddit threads ranking on Google's first page for your keywords. Join the conversation, get referral traffic, and build brand signals for AI search. Free, no login.",
    images: ["/og-image.png"],
  },
};

const redditSeoSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Free Reddit SEO Tool",
  url: `${SITE_URL}/free/reddit-seo`,
  applicationCategory: "UtilityApplication",
  operatingSystem: "Web",
  description:
    "Find Reddit threads ranking on Google's first page for your keywords. Join the conversation, get referral traffic, and build brand signals for AI search. Free, no login.",
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
    "Find Reddit threads ranking on Google page 1",
    "Keyword-based Reddit opportunity discovery",
    "Referral traffic and brand signal analysis",
    "AI search visibility boost through Reddit presence",
  ],
};

const redditBreadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "Free Tools", item: `${SITE_URL}/free/reddit-seo` },
    { "@type": "ListItem", position: 3, name: "Reddit SEO Tool", item: `${SITE_URL}/free/reddit-seo` },
  ],
};

export default function RedditSeoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(redditSeoSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(redditBreadcrumbSchema) }} />
      {children}
    </>
  );
}
