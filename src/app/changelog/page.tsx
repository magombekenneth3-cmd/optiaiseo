import { Metadata } from "next";
import prisma from "@/lib/prisma";

const CHANGELOG_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
    title: "Changelog | OptiAISEO",
    description: "All product updates, new features, bug fixes, and improvements to the OptiAISEO platform.",
    alternates: { canonical: `${CHANGELOG_SITE_URL}/changelog` },
    openGraph: {
        title: "Changelog | OptiAISEO",
        description: "All product updates, new features, bug fixes, and improvements to the OptiAISEO platform.",
        url: `${CHANGELOG_SITE_URL}/changelog`,
        siteName: "OptiAISEO",
        type: "website",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO Changelog" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "Changelog | OptiAISEO",
        description: "All product updates, new features, bug fixes, and improvements to the OptiAISEO platform.",
        images: ["/og-image.png"],
    },
};

export const dynamic = "force-dynamic";

const CATEGORY_STYLES: Record<string, { label: string; dot: string; badge: string }> = {
    feature:     { label: "New Feature",   dot: "bg-emerald-400", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    improvement: { label: "Improvement",   dot: "bg-blue-400",    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    fix:         { label: "Bug Fix",       dot: "bg-amber-400",   badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    security:    { label: "Security",      dot: "bg-red-400",     badge: "bg-red-500/10 text-red-400 border-red-500/20" },
};

function monthKey(d: Date) {
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

const CHANGELOG_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Changelog | OptiAISEO",
  "url": "https://www.optiaiseo.online/changelog",
  "description": "All product updates, new features, bug fixes, and improvements to the OptiAISEO platform.",
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

export default async function ChangelogPage() {
    const entries = await prisma.changelog.findMany({
        where: { isPublic: true },
        orderBy: { publishedAt: "desc" },
    });

    // Group entries by month
    const grouped: Record<string, typeof entries> = {};
    for (const entry of entries) {
        const key = monthKey(new Date(entry.publishedAt));
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(entry);
    }

    return (
        <main className="min-h-screen bg-background" id="main-content">
            {/* Hero */}
            <section className="border-b border-border bg-gradient-to-b from-brand/5 to-transparent py-16 px-6 text-center">
                <span className="inline-block px-3 py-1 rounded-full border border-brand/30 bg-brand/10 text-brand text-xs font-semibold mb-4 tracking-wide uppercase">
                    Product Updates
                </span>
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">Changelog</h1>
                <p className="text-muted-foreground text-lg max-w-xl mx-auto">
                    Every update, fix, and new feature — shipped fast and documented clearly.
                </p>
            </section>

            {/* Content */}
            <section className="max-w-3xl mx-auto px-6 py-12">
                {Object.keys(grouped).length === 0 ? (
                    <div className="text-center py-20 text-muted-foreground">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(CHANGELOG_SCHEMA) }} />
                        <div className="text-4xl mb-3">🚀</div>
                        <p className="font-semibold">No entries yet</p>
                        <p className="text-sm mt-1">Check back soon for updates.</p>
                    </div>
                ) : (
                    <div className="space-y-12">
                        {Object.entries(grouped).map(([month, items]) => (
                            <div key={month}>
                                {/* Month header */}
                                <div className="flex items-center gap-4 mb-6">
                                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                                        {month}
                                    </h2>
                                    <div className="flex-1 h-px bg-border" />
                                </div>

                                {/* Entries */}
                                <div className="space-y-6">
                                    {items.map(entry => {
                                        const style = CATEGORY_STYLES[entry.category] ?? CATEGORY_STYLES["improvement"];
                                        return (
                                            <article
                                                key={entry.id}
                                                className="relative pl-8 group"
                                            >
                                                {/* Timeline spine + dot */}
                                                <div className="absolute left-0 top-1.5 bottom-0 w-px bg-border group-last:hidden" />
                                                <div className={`absolute left-[-3.5px] top-1.5 w-2 h-2 rounded-full ${style.dot} ring-2 ring-background`} />

                                                <div className="card-surface p-5 hover:border-border transition-colors">
                                                    <div className="flex flex-wrap items-center gap-3 mb-3">
                                                        {entry.version && (
                                                            <span className="font-mono text-xs text-muted-foreground bg-card px-2 py-0.5 rounded border border-border">
                                                                v{entry.version}
                                                            </span>
                                                        )}
                                                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${style.badge}`}>
                                                            {style.label}
                                                        </span>
                                                        <time className="text-xs text-muted-foreground ml-auto">
                                                            {new Date(entry.publishedAt).toLocaleDateString("en-US", {
                                                                day: "numeric", month: "short", year: "numeric",
                                                            })}
                                                        </time>
                                                    </div>
                                                    <h3 className="font-semibold text-base mb-2">{entry.title}</h3>
                                                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                                                        {entry.description}
                                                    </p>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </main>
    );
}
