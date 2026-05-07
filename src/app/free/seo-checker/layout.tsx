import type { Metadata } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Free SEO Audit Tool — Instant Website SEO Checker",
  description:
    "Free website SEO checker. Scan any URL for technical issues, Core Web Vitals, on-page problems, and missing meta tags. Instant results, no sign-up required.",
  alternates: {
    canonical: `${SITE_URL}/free/seo-checker`,
  },
  openGraph: {
    title: "Free SEO Audit Tool — Instant Website SEO Checker",
    description:
      "Check your website SEO for free. Instant audit covering technical SEO, Core Web Vitals, on-page issues, schema markup, and page speed. No account required.",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO Free SEO Audit Tool" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Free SEO Audit Tool — Website SEO Checker",
    description: "Instant free SEO audit. Checks title tags, meta descriptions, H1, Core Web Vitals, canonical, schema, and more.",
    images: ["/og-image.png"],
  },
};

export default function FreeSeoCheckerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
