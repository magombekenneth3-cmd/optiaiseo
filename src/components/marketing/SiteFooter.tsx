import Link from "next/link";

const FOOTER_LINKS = [
  {
    heading: "Product",
    links: [
      { href: "/pricing",      label: "Pricing" },
      { href: "/aria",         label: "Aria Voice Copilot" },
      { href: "/changelog",    label: "Changelog" },
      { href: "/methodology",  label: "AEO Methodology" },
      { href: "/case-studies", label: "Case Studies" },
    ],
  },
  {
    heading: "Solutions",
    links: [
      { href: "/for-agencies",  label: "For Agencies" },
      { href: "/for-saas",      label: "For SaaS" },
      { href: "/for-content",   label: "For Content Teams" },
      { href: "/for-ecommerce", label: "For E-commerce" },
    ],
  },
  {
    heading: "Disciplines",
    links: [
      { href: "/seo",  label: "SEO" },
      { href: "/geo",  label: "GEO" },
      { href: "/aeo",  label: "AEO" },
      { href: "/aio",  label: "AIO" },
      { href: "/pseo", label: "Programmatic SEO" },
    ],
  },
  {
    heading: "Free Tools",
    links: [
      { href: "/free/seo-checker",  label: "Free SEO Checker" },
      { href: "/free/gso-checker",  label: "Free AI Checker" },
      { href: "/free/reddit-seo",   label: "Reddit SEO Finder" },
      { href: "/tools",             label: "SEO Tool Guides" },
      { href: "/blog",              label: "SEO Blog" },
      { href: "/leaderboard",       label: "AI SEO Leaderboard" },
    ],
  },
  {
    heading: "Compare",
    links: [
      { href: "/vs",              label: "All Comparisons" },
      { href: "/vs/semrush",      label: "vs Semrush" },
      { href: "/vs/ahrefs",       label: "vs Ahrefs" },
      { href: "/vs/surfer-seo",   label: "vs Surfer SEO" },
      { href: "/vs/moz",          label: "vs Moz" },
      { href: "/vs/clearscope",   label: "vs Clearscope" },
      { href: "/vs/mangools",     label: "vs Mangools" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about",    label: "About" },
      { href: "/contact",  label: "Contact" },
      { href: "/security", label: "Security" },
      { href: "/terms",    label: "Terms" },
      { href: "/privacy",  label: "Privacy Policy" },
    ],
  },
];

const SOCIAL_LINKS = [
  {
    href: "https://twitter.com/aiseoseo",
    label: "OptiAISEO on X (Twitter)",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.735-8.857L1.254 2.25H8.08l4.261 5.635L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    ),
  },
  {
    href: "https://linkedin.com/company/aiseoseo",
    label: "OptiAISEO on LinkedIn",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    href: "https://github.com/kenneth256",
    label: "OptiAISEO on GitHub",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    ),
  },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background" aria-label="Site footer">
      <div className="max-w-7xl mx-auto px-6 pt-16 pb-8">

        {/* Brand + social */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-10">
          <div className="flex flex-col gap-1">
            <Link href="/" className="flex items-center gap-2.5" aria-label="OptiAISEO home">
              <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
                <span className="font-black text-background text-[11px] tracking-tight">AI</span>
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
                <span className="text-[10px] text-muted-foreground">AI Search Visibility Platform</span>
              </div>
            </Link>
          </div>
          <nav aria-label="Social media links" className="flex items-center gap-4">
            {SOCIAL_LINKS.map(({ href, label, icon }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noreferrer me noopener"
                aria-label={label}
                className="text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent"
              >
                {icon}
              </a>
            ))}
          </nav>
        </div>

        {/* Link columns */}
        <div className="border-t border-border pt-10">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-8 mb-10 text-xs">
            {FOOTER_LINKS.map(({ heading, links }) => (
              <div key={heading}>
                <p className="font-semibold text-foreground mb-3 uppercase tracking-widest text-[10px]">
                  {heading}
                </p>
                <nav aria-label={`${heading} pages`} className="flex flex-col gap-2 text-muted-foreground">
                  {links.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      className="hover:text-foreground transition-colors"
                    >
                      {label}
                    </Link>
                  ))}
                </nav>
              </div>
            ))}
          </div>

          {/* Bottom bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border pt-6 flex-wrap">
            <p className="text-xs text-muted-foreground/50 text-center sm:text-left">
              AI Search Visibility &amp; Answer Engine Optimization Platform
            </p>
            {/* ScamAdviser trust widget — official embed */}
            <a
              href="https://scamadviser.com/check-website/optiaiseo.online"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Check OptiAISEO on ScamAdviser — Verified Trusted Site"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
              Verified on ScamAdviser
            </a>
            <p className="text-xs text-muted-foreground/40 text-center sm:text-right">
              © {new Date().getFullYear()} OptiAISEO. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
