import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart2, TrendingUp, Users } from "lucide-react";
import { MarketingNav } from "@/components/marketing/MarketingNav";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
    title: "SEO Case Studies | Proven Results | OptiAISEO",
    description: "Real-world SEO and AEO results from OptiAISEO users. See how teams improved organic traffic, AI citation rates, and agency efficiency with OptiAISEO.",
    alternates: { canonical: `${SITE_URL}/case-studies` },
    openGraph: {
        title: "SEO Case Studies | Proven Results | OptiAISEO",
        description: "Real-world SEO and AEO results from OptiAISEO users. See how teams improved organic traffic and AI citation rates.",
        url: `${SITE_URL}/case-studies`,
        siteName: "OptiAISEO",
        type: "website",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO Case Studies" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "SEO Case Studies | Proven Results | OptiAISEO",
        description: "Real-world SEO and AEO results from OptiAISEO users.",
        images: ["/og-image.png"],
    },
};

const PROJECTED_OUTCOMES = [
    {
        icon: TrendingUp,
        metric: "Organic traffic",
        description: "Sites that complete a full audit and apply all recommended fixes typically see measurable organic traffic improvements within 60 days.",
        color: "emerald",
    },
    {
        icon: BarChart2,
        metric: "AEO citation rate",
        description: "Adding structured FAQ schema and AI-readable content blocks is the fastest way to improve how often AI engines cite your brand in answers.",
        color: "blue",
    },
    {
        icon: Users,
        metric: "Agency time savings",
        description: "Teams using Aria for audit delivery report significant reductions in manual reporting time per client per month.",
        color: "violet",
    },
];

const CASE_STUDIES_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "Customer Results - OptiAISEO",
  "url": "https://www.optiaiseo.online/case-studies",
  "description": "Real-world results from OptiAISEO users on AI citation improvement and SEO ranking gains.",
  "publisher": {
    "@type": "Organization",
    "name": "OptiAISEO",
    "url": "https://www.optiaiseo.online",
    "logo": {
      "@type": "ImageObject",
      "url": "https://www.optiaiseo.online/logo.png"
    }
  }
};

export default function CaseStudiesPage() {
    return (
        <div className="min-h-screen bg-background">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(CASE_STUDIES_SCHEMA) }} />
            <MarketingNav />

            <main className="max-w-4xl mx-auto px-6 py-24">
                {/* Hero */}
                <div className="text-center mb-20">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card text-xs font-medium text-muted-foreground mb-6">
                        <span className="flex h-2 w-2 rounded-full bg-brand animate-pulse" />
                        Coming soon
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-6">
                        Real results from real users
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
                        We&apos;re collecting verified case studies from OptiAISEO users. We only publish numbers we can confirm — no invented stats, no anonymous fabrications.
                        <br /><br />
                        The first case studies will be published once we have results we can stand behind with real data.
                    </p>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-foreground text-background font-bold text-base hover:opacity-90 transition-all active:scale-95"
                    >
                        Start free — get results worth sharing
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>

                {/* What to expect */}
                <div className="mb-20">
                    <h2 className="text-2xl font-bold tracking-tight text-center mb-10">What the data typically shows</h2>
                    <p className="text-center text-muted-foreground text-sm mb-10 max-w-xl mx-auto">
                        Based on what the OptiAISEO platform measures — verified outcomes will be published as users share their data.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {PROJECTED_OUTCOMES.map(({ icon: Icon, metric, description, color }) => (
                            <div
                                key={metric}
                                className="card-surface rounded-2xl p-7 border border-border flex flex-col gap-4"
                            >
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-${color}-500/10 border border-${color}-500/20`}>
                                    <Icon className={`w-5 h-5 text-${color}-400`} />
                                </div>
                                <h3 className="font-bold text-base">{metric}</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Be featured */}
                <div className="card-surface rounded-2xl border border-border p-10 text-center">
                    <h2 className="text-2xl font-bold mb-4">Want to be our first case study?</h2>
                    <p className="text-muted-foreground max-w-lg mx-auto mb-8">
                        Connect your site, run audits for 60 days, and share your before/after data. We&apos;ll write it up, give you full approval, and publish it with your name (or anonymously if you prefer).
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-4">
                        <Link
                            href="/signup"
                            className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-foreground text-background font-bold hover:opacity-90 transition-all"
                        >
                            Start free — no card needed
                        </Link>
                        <Link
                            href="/about"
                            className="inline-flex items-center gap-2 px-7 py-3 rounded-full border border-border font-semibold hover:bg-accent transition-all"
                        >
                            Learn about us
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}
