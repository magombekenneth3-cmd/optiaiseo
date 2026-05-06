import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/marketing/SiteFooter";

const CONTACT_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Contact OptiAISEO — Get in Touch",
  description: "Contact the OptiAISEO team for support, billing questions, or partnership enquiries. We respond within one business day.",
  alternates: { canonical: `${CONTACT_SITE_URL}/contact` },
  openGraph: {
    title: "Contact OptiAISEO — Get in Touch",
    description: "Contact the OptiAISEO team for support, billing questions, or partnership enquiries. We respond within one business day.",
    url: `${CONTACT_SITE_URL}/contact`,
    siteName: "OptiAISEO",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Contact OptiAISEO" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Contact OptiAISEO — Get in Touch",
    description: "Contact the OptiAISEO team for support, billing questions, or partnership enquiries.",
    images: ["/og-image.png"],
  },
};

export default function ContactPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    "name": "Contact OptiAISEO",
    "url": "https://www.optiaiseo.online/contact",
    "description": "Contact the OptiAISEO team for support, billing questions, or partnership enquiries.",
    "mainEntity": {
      "@type": "Organization",
      "name": "OptiAISEO",
      "url": "https://www.optiaiseo.online",
      "email": "support@optiaiseo.online",
      "contactPoint": {
        "@type": "ContactPoint",
        "email": "support@optiaiseo.online",
        "contactType": "customer support",
        "availableLanguage": "English"
      }
    }
  };
  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg" style={{ color: "var(--brand)" }}>
          OptiAISEO
        </Link>
        <Link href="/signup" className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
          Get started free →
        </Link>
      </nav>

      <main className="max-w-xl mx-auto px-6 py-20">
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--brand)" }}>Contact</span>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tighter mt-4 mb-5 text-foreground">
          Get in touch
        </h1>
        <p className="text-muted-foreground mb-10 leading-relaxed text-lg">
          For support, billing questions, or partnership enquiries — email us directly.
          We respond within one business day.
        </p>

        <div className="space-y-4 mb-12">
          <div className="border border-border rounded-2xl p-5 hover:border-[var(--brand-border)] transition-colors group">
            <p className="text-xs font-bold text-muted-foreground mb-1.5 uppercase tracking-widest">Support &amp; Product</p>
            <a
              href="mailto:support@optiaiseo.online"
              className="text-base font-semibold hover:underline transition-opacity"
              style={{ color: "var(--brand)" }}
            >
              support@optiaiseo.online
            </a>
            <p className="text-xs text-muted-foreground mt-1.5">Bugs, feature requests, account help, billing issues</p>
          </div>

          <div className="border border-border rounded-2xl p-5 hover:border-[var(--brand-border)] transition-colors group">
            <p className="text-xs font-bold text-muted-foreground mb-1.5 uppercase tracking-widest">Partnerships &amp; Press</p>
            <a
              href="mailto:support@optiaiseo.online"
              className="text-base font-semibold hover:underline transition-opacity"
              style={{ color: "var(--brand)" }}
            >
              support@optiaiseo.online
            </a>
            <p className="text-xs text-muted-foreground mt-1.5">Agency partnerships, media enquiries, affiliate programme</p>
          </div>
        </div>

        <div className="border-t border-border pt-8">
          <p className="text-sm font-semibold text-foreground mb-4">Quick links</p>
          <div className="flex flex-wrap gap-3">
            {[
              { label: "View pricing", href: "/pricing" },
              { label: "Free SEO audit", href: "/free/seo-checker" },
              { label: "About the team", href: "/about" },
              { label: "Read the blog", href: "/blog" },
            ].map(({ label, href }) => (
              <Link
                key={label}
                href={href}
                className="text-sm px-4 py-2 rounded-xl border border-border hover:border-[var(--brand-border)] hover:text-foreground text-muted-foreground transition-all"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
