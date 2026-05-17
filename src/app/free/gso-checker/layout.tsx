import type { Metadata } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Free AI Visibility Check — GSoV Scanner | OptiAISEO",
  description:
    "Check how visible your brand is in ChatGPT, Claude, Perplexity, and Google AI Overviews. Free Generative Share of Voice scanner — no login required.",
  alternates: { canonical: `${SITE_URL}/free/gso-checker` },
  openGraph: {
    title: "Free AI Visibility Check — GSoV Scanner | OptiAISEO",
    description: "Check how visible your brand is across AI search engines. Free — no login required.",
    url: `${SITE_URL}/free/gso-checker`,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

const gsoCheckerSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Free AI Visibility Check — GSoV Scanner",
  url: `${SITE_URL}/free/gso-checker`,
  applicationCategory: "UtilityApplication",
  operatingSystem: "Web",
  description:
    "Scan how often ChatGPT, Claude, Perplexity, and Google AI Overviews mention your brand. Get your Generative Share of Voice (GSoV) grade, mention rate, and AI citation categories — all free, no login required.",
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
    "Generative Share of Voice (GSoV) scoring",
    "AI citation rate across ChatGPT, Claude, Perplexity, Google AI",
    "Brand mention frequency analysis",
    "AI visibility grade (A–F)",
    "Category-level pass/fail assessment",
  ],
};

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "Free Tools", item: `${SITE_URL}/free/gso-checker` },
    { "@type": "ListItem", position: 3, name: "AI Visibility Check", item: `${SITE_URL}/free/gso-checker` },
  ],
};

export default function GsoCheckerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(gsoCheckerSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      {children}
    </>
  );
}
