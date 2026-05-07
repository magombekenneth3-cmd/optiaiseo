import type { Metadata } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

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

export default function RedditSeoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
