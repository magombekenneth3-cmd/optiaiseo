import { Metadata } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
    title: "Free AI Visibility Checker — Is Your Brand in ChatGPT?",
    description: "Check if your brand appears in ChatGPT, Claude, and Perplexity for free. Measure your Generative Share of Voice and see which AI engines cite your site.",
    alternates: { canonical: `${SITE_URL}/free/gso-checker` },
    openGraph: {
        title: "Free AI Visibility Checker — Brand Citations in ChatGPT & Perplexity",
        description: "Find out if AI search engines mention your brand. Free Generative Share of Voice checker covering ChatGPT, Claude, Perplexity, and Google AI Overviews.",
        type: "website",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO AI Visibility Checker" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "Free AI Visibility Checker — GSoV Score | OptiAISEO",
        description: "Is your brand cited in ChatGPT, Claude, or Perplexity? Check your AI visibility score for free.",
        images: ["/og-image.png"],
    },
};

export default function FreeCheckerLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
