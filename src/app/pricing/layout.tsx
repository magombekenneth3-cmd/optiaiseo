import { Metadata } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
    title: "SEO Tool Pricing — Free Plan Available | OptiAISEO",
    description: "OptiAISEO starts free. Transparent SEO software pricing: Free, Starter ($19/mo), Pro ($49/mo), Agency ($149/mo). Full AI SEO audits, schema fixes, and AEO tracking on every plan.",
    alternates: { canonical: `${SITE_URL}/pricing` },
    openGraph: {
        title: "SEO Tool Pricing — Free Plan Included | OptiAISEO",
        description: "Start with a free SEO audit tool — no credit card needed. Upgrade for unlimited audits, AI content, rank tracking, and competitor gap analysis.",
        type: "website",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO Pricing Plans" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "OptiAISEO Pricing — Free SEO Tool + Paid Plans",
        description: "Free plan available. Full-featured AI SEO platform from $19/mo. Compare plans for agencies, startups, and solo creators.",
        images: ["/og-image.png"],
    },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
