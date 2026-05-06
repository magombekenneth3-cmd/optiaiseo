import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/marketing/SiteFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");
const PAGE_URL = `${SITE_URL}/aeo`;
const TITLE = "Track Your Brand in ChatGPT, Claude & Perplexity | OptiAISEO";
const DESC = "See exactly where your brand appears across ChatGPT, Claude, Perplexity & Gemini. Daily AI citation tracking in one dashboard. Try free.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: TITLE, description: DESC, url: "/aeo", type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: ["/og-image.png"] },
};

const schemas = [
  {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "AEO Guide", item: PAGE_URL },
    ],
  },
  {
    "@context": "https://schema.org", "@type": "Article",
    headline: TITLE, description: DESC, url: PAGE_URL,
    datePublished: "2024-06-01",
    dateModified: new Date().toISOString().split("T")[0],
    author: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
    publisher: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
  },
  {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: [
      { q: "What is Answer Engine Optimization (AEO)?", a: "AEO is the discipline of structuring content so that AI answer engines — Google AI Overviews, ChatGPT, Bing Copilot, and voice assistants — extract and present your content as the direct answer to user questions." },
      { q: "How is AEO different from SEO?", a: "SEO ranks pages in a list of results. AEO wins position zero — the answer box or AI response that appears before any list. It requires direct-answer formatting, schema markup, and E-E-A-T signals." },
      { q: "What schema types are most important?", a: "FAQPage and HowTo schemas are the most effective for AEO. Article and BreadcrumbList schemas signal content hierarchy. SpecialAnnouncement and QAPage work for specific content types." },
      { q: "What is a featured snippet?", a: "A featured snippet is the answer box that appears above organic results in Google. Winning it typically requires a direct definition or numbered list in the first 100 words of the page." },
      { q: "How do voice assistants choose answers?", a: "Voice assistants source answers from featured snippets, FAQ schemas, and highly-cited authoritative pages. Content written in conversational, direct-answer format is prioritized." },
      { q: "How do I track AEO performance?", a: "Monitor featured snippet wins in Google Search Console. Run AEO citation audits across ChatGPT, Claude, and Perplexity using OptiAISEO's AEO scanner." },
    ].map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  },
];

const PLATFORMS = [
  { name: "ChatGPT", score: 94, color: "#10b981" },
  { name: "Perplexity", score: 87, color: "#10b981" },
  { name: "Claude", score: 91, color: "#10b981" },
  { name: "Gemini", score: 82, color: "#10b981" },
];

const TACTICS = [
  {
    num: "01",
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#10b981" strokeWidth="1.5"/><path d="M7 10h6M10 7v6" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/></svg>`,
    title: "FAQPage Schema",
    desc: "Structured FAQ markup extracts Q&A pairs directly into Google's answer boxes and AI chat responses.",
    impact: "High",
  },
  {
    num: "02",
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="#10b981" strokeWidth="1.5"/><path d="M7 7h6M7 10h4M7 13h5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/></svg>`,
    title: "HowTo Schema",
    desc: "Numbered steps with JSON-LD HowTo schema appear in voice results and AI step-by-step answers.",
    impact: "High",
  },
  {
    num: "03",
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 6h12M4 10h8M4 14h10" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/></svg>`,
    title: "Definition Paragraphs",
    desc: "Open every article with a direct definition. AI extracts the first 1–2 sentences most frequently.",
    impact: "Medium",
  },
  {
    num: "04",
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v14M3 10l7-7 7 7" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>`,
    title: "Voice Search Format",
    desc: "Write conversational, complete-sentence answers. Voice assistants dislike fragmented bullet lists.",
    impact: "Medium",
  },
  {
    num: "05",
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><polygon points="10,2 12.8,8.2 19.5,8.7 14.5,13.1 16.2,19.5 10,16 3.8,19.5 5.5,13.1 0.5,8.7 7.2,8.2" stroke="#10b981" strokeWidth="1.5" fill="none"/></svg>`,
    title: "E-E-A-T Signals",
    desc: "Experience, Expertise, Authoritativeness, Trustworthiness. Link author bios, cite sources, add credentials.",
    impact: "High",
  },
  {
    num: "06",
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3C6.13 3 3 6.13 3 10s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7z" stroke="#10b981" strokeWidth="1.5"/><path d="M10 7v3l2 2" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/></svg>`,
    title: "Internal Answer Links",
    desc: "Link every FAQ answer to a dedicated deep-dive page, building a semantic web AI systems can traverse.",
    impact: "Medium",
  },
];

const FAQS = [
  {
    q: "What is Answer Engine Optimization (AEO)?",
    a: "AEO is the discipline of structuring your content so AI answer engines can extract and present it as the direct answer to a user's question — without the user clicking through to your site.",
  },
  {
    q: "How is AEO different from SEO?",
    a: "SEO ranks pages in a list. AEO wins position zero — the answer box or AI response that appears before any list. AEO requires direct-answer formatting, schema markup, and E-E-A-T signals that AI prioritizes over keyword density.",
  },
  {
    q: "What schema types are most important for AEO?",
    a: "FAQPage and HowTo schemas are the most effective. Article and BreadcrumbList schemas signal hierarchy. SpecialAnnouncement and QAPage work for specific formats. OptiAISEO auto-injects all relevant schemas after audit.",
  },
  {
    q: "What is a featured snippet?",
    a: "A featured snippet is the answer box above organic results in Google. Winning it requires a direct definition or numbered list in the first 100 words, plus structured data to signal the content type.",
  },
  {
    q: "How do voice assistants choose their answers?",
    a: "Voice assistants source answers from featured snippets, FAQ schemas, and highly-cited authoritative pages. Content in conversational, direct-answer format without marketing preamble is prioritized.",
  },
  {
    q: "How do I track AEO performance?",
    a: "Monitor featured snippet wins in Google Search Console. Run AEO citation audits across ChatGPT, Claude, and Perplexity using OptiAISEO's AEO scanner — it shows your citation rate per query category.",
  },
];

const RELATED = [
  { label: "SEO", sub: "Search Engine Optimization", href: "/seo" },
  { label: "GEO", sub: "Generative Engine Optimization", href: "/geo" },
  { label: "AIO", sub: "AI Optimization", href: "/aio" },
  { label: "pSEO", sub: "Programmatic SEO", href: "/pseo" },
  { label: "Free", sub: "SEO Audit Tool", href: "/free/seo-checker" },
];

export default function AeoPage() {
  return (
    <>
      {schemas.map((s, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(s) }} />
      ))}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap');

        .aeo-root {
          --em: #10b981;
          --em-dim: rgba(16,185,129,0.12);
          --em-mid: rgba(16,185,129,0.25);
          --em-glow: rgba(16,185,129,0.06);
          --bg: #040d08;
          --bg-2: #07130d;
          --bg-3: #0a1a10;
          --text: #e8f5ee;
          --text-2: #8aab94;
          --text-3: #4d6b56;
          --border: rgba(16,185,129,0.12);
          --border-2: rgba(16,185,129,0.22);
          --serif: 'Instrument Serif', Georgia, serif;
          --sans: 'DM Sans', system-ui, sans-serif;
          --mono: 'JetBrains Mono', monospace;
          min-height: 100vh;
          background: var(--bg);
          color: var(--text);
          font-family: var(--sans);
        }

        /* ---------- noise overlay ---------- */
        .aeo-root::before {
          content: '';
          position: fixed;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E");
          pointer-events: none;
          z-index: 0;
          opacity: 0.4;
        }

        /* ---------- grid lines ---------- */
        .aeo-grid-bg {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(16,185,129,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(16,185,129,0.04) 1px, transparent 1px);
          background-size: 64px 64px;
          mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, black 20%, transparent 80%);
        }

        /* ---------- nav ---------- */
        .aeo-nav {
          position: sticky;
          top: 0;
          z-index: 50;
          border-bottom: 1px solid var(--border);
          background: rgba(4,13,8,0.85);
          backdrop-filter: blur(20px);
        }
        .aeo-nav-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 32px;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .aeo-logo {
          font-family: var(--sans);
          font-weight: 500;
          font-size: 17px;
          color: var(--text);
          text-decoration: none;
          letter-spacing: -0.02em;
        }
        .aeo-logo em { color: var(--em); font-style: normal; }
        .aeo-nav-links {
          display: flex;
          align-items: center;
          gap: 28px;
        }
        .aeo-nav-link {
          font-size: 13px;
          color: var(--text-2);
          text-decoration: none;
          letter-spacing: 0.01em;
          transition: color 0.2s;
        }
        .aeo-nav-link:hover { color: var(--text); }
        .aeo-btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 18px;
          background: var(--em);
          color: #021208;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          text-decoration: none;
          letter-spacing: 0.01em;
          transition: background 0.2s, transform 0.15s;
        }
        .aeo-btn-primary:hover { background: #0ea572; transform: translateY(-1px); }
        .aeo-btn-ghost {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 22px;
          background: transparent;
          color: var(--text-2);
          border: 1px solid var(--border-2);
          border-radius: 10px;
          font-size: 14px;
          font-weight: 400;
          text-decoration: none;
          letter-spacing: 0.01em;
          transition: all 0.2s;
        }
        .aeo-btn-ghost:hover {
          background: var(--em-dim);
          color: var(--em);
          border-color: var(--em-mid);
        }

        /* ---------- hero ---------- */
        .aeo-hero {
          position: relative;
          padding: 100px 32px 80px;
          overflow: hidden;
          text-align: center;
        }
        .aeo-hero-orb-1 {
          position: absolute;
          top: -120px;
          left: 50%;
          transform: translateX(-50%);
          width: 600px;
          height: 400px;
          background: radial-gradient(ellipse, rgba(16,185,129,0.14) 0%, transparent 70%);
          pointer-events: none;
        }
        .aeo-hero-orb-2 {
          position: absolute;
          top: 40px;
          right: -80px;
          width: 300px;
          height: 300px;
          background: radial-gradient(ellipse, rgba(16,185,129,0.06) 0%, transparent 70%);
          pointer-events: none;
        }
        .aeo-breadcrumb {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-3);
          margin-bottom: 28px;
          font-family: var(--mono);
          letter-spacing: 0.05em;
        }
        .aeo-breadcrumb a { color: var(--text-3); text-decoration: none; }
        .aeo-breadcrumb a:hover { color: var(--em); }
        .aeo-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--em-dim);
          border: 1px solid var(--border-2);
          border-radius: 100px;
          padding: 6px 16px;
          font-size: 12px;
          font-weight: 500;
          color: var(--em);
          margin-bottom: 28px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .aeo-pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--em);
          animation: pulse-dot 2s ease-in-out infinite;
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }
        .aeo-h1 {
          font-family: var(--serif);
          font-size: clamp(40px, 7vw, 72px);
          font-weight: 400;
          line-height: 1.08;
          letter-spacing: -0.02em;
          color: var(--text);
          margin: 0 0 24px;
        }
        .aeo-h1 em { color: var(--em); font-style: italic; }
        .aeo-hero-sub {
          font-size: 18px;
          color: var(--text-2);
          max-width: 560px;
          margin: 0 auto 40px;
          line-height: 1.7;
          font-weight: 300;
        }
        .aeo-hero-ctas {
          display: flex;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .aeo-btn-em {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 14px 28px;
          background: var(--em);
          color: #021208;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 500;
          text-decoration: none;
          transition: all 0.2s;
          letter-spacing: -0.01em;
        }
        .aeo-btn-em:hover { background: #0ea572; transform: translateY(-2px); box-shadow: 0 8px 32px rgba(16,185,129,0.3); }

        /* ---------- platform strip ---------- */
        .aeo-platforms {
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
          background: var(--bg-2);
          padding: 36px 32px;
        }
        .aeo-platforms-inner {
          max-width: 900px;
          margin: 0 auto;
        }
        .aeo-platforms-label {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.1em;
          color: var(--text-3);
          text-transform: uppercase;
          text-align: center;
          margin-bottom: 28px;
        }
        .aeo-platforms-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1px;
          background: var(--border);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
        }
        .aeo-platform-card {
          background: var(--bg-2);
          padding: 24px 20px;
          text-align: center;
          transition: background 0.2s;
        }
        .aeo-platform-card:hover { background: var(--bg-3); }
        .aeo-platform-name {
          font-size: 12px;
          color: var(--text-3);
          letter-spacing: 0.04em;
          margin-bottom: 12px;
          font-family: var(--mono);
          text-transform: uppercase;
        }
        .aeo-platform-score {
          font-family: var(--mono);
          font-size: 32px;
          font-weight: 500;
          color: var(--em);
          line-height: 1;
          margin-bottom: 8px;
        }
        .aeo-platform-bar {
          height: 2px;
          background: var(--border);
          border-radius: 2px;
          overflow: hidden;
          margin: 0 auto;
          width: 80%;
        }
        .aeo-platform-bar-fill {
          height: 100%;
          background: var(--em);
          border-radius: 2px;
          transition: width 1s cubic-bezier(0.4,0,0.2,1);
        }

        /* ---------- what is section ---------- */
        .aeo-section {
          max-width: 1100px;
          margin: 0 auto;
          padding: 80px 32px;
        }
        .aeo-section-label {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.1em;
          color: var(--em);
          text-transform: uppercase;
          margin-bottom: 20px;
        }
        .aeo-h2 {
          font-family: var(--serif);
          font-size: clamp(28px, 4vw, 44px);
          font-weight: 400;
          line-height: 1.18;
          letter-spacing: -0.02em;
          color: var(--text);
          margin: 0 0 28px;
        }
        .aeo-prose {
          font-size: 17px;
          line-height: 1.8;
          color: var(--text-2);
          font-weight: 300;
          max-width: 680px;
        }
        .aeo-prose strong { color: var(--text); font-weight: 500; }

        /* vs-seo comparison */
        .aeo-compare {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1px;
          background: var(--border);
          border: 1px solid var(--border);
          border-radius: 14px;
          overflow: hidden;
          margin-top: 48px;
        }
        .aeo-compare-col {
          background: var(--bg-2);
          padding: 32px;
        }
        .aeo-compare-col.active { background: var(--bg-3); }
        .aeo-compare-tag {
          display: inline-block;
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 4px;
          margin-bottom: 16px;
          font-weight: 500;
        }
        .aeo-compare-tag.seo  { background: rgba(255,255,255,0.06); color: var(--text-3); }
        .aeo-compare-tag.aeo  { background: var(--em-dim); color: var(--em); border: 1px solid var(--em-mid); }
        .aeo-compare-title {
          font-family: var(--serif);
          font-size: 22px;
          font-weight: 400;
          color: var(--text);
          margin: 0 0 12px;
        }
        .aeo-compare-desc {
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-2);
          font-weight: 300;
        }
        .aeo-compare-items { margin-top: 20px; display: flex; flex-direction: column; gap: 8px; }
        .aeo-compare-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: var(--text-2);
        }
        .aeo-compare-item .dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .seo .dot { background: var(--text-3); }
        .aeo .dot { background: var(--em); }

        /* ---------- tactics ---------- */
        .aeo-tactics-bg {
          background: var(--bg-2);
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
        }
        .aeo-tactics-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1px;
          background: var(--border);
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
          margin-top: 48px;
        }
        .aeo-tactic {
          background: var(--bg-2);
          padding: 32px;
          position: relative;
          transition: background 0.2s;
          cursor: default;
        }
        .aeo-tactic:hover { background: var(--bg-3); }
        .aeo-tactic-num {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-3);
          letter-spacing: 0.06em;
          margin-bottom: 20px;
        }
        .aeo-tactic-icon {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--em-dim);
          border: 1px solid var(--border-2);
          border-radius: 8px;
          margin-bottom: 16px;
        }
        .aeo-tactic-title {
          font-size: 15px;
          font-weight: 500;
          color: var(--text);
          margin-bottom: 10px;
          letter-spacing: -0.01em;
        }
        .aeo-tactic-desc {
          font-size: 13px;
          line-height: 1.65;
          color: var(--text-2);
          font-weight: 300;
        }
        .aeo-tactic-impact {
          display: inline-block;
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 3px 8px;
          border-radius: 4px;
          margin-top: 16px;
          font-weight: 500;
        }
        .aeo-tactic-impact.High   { background: var(--em-dim);              color: var(--em);   border: 1px solid var(--border-2); }
        .aeo-tactic-impact.Medium { background: rgba(255,185,0,0.08); color: #c9933a; border: 1px solid rgba(255,185,0,0.18); }

        /* ---------- CTA banner ---------- */
        .aeo-cta-banner {
          position: relative;
          overflow: hidden;
          background: var(--bg-3);
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
          padding: 72px 32px;
          text-align: center;
        }
        .aeo-cta-orb {
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 70% 80% at 50% 50%, rgba(16,185,129,0.08) 0%, transparent 70%);
          pointer-events: none;
        }
        .aeo-cta-inner {
          position: relative;
          max-width: 680px;
          margin: 0 auto;
        }
        .aeo-cta-eyebrow {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.1em;
          color: var(--em);
          text-transform: uppercase;
          margin-bottom: 16px;
        }
        .aeo-cta-title {
          font-family: var(--serif);
          font-size: clamp(24px, 3.5vw, 40px);
          font-weight: 400;
          line-height: 1.2;
          letter-spacing: -0.02em;
          color: var(--text);
          margin-bottom: 16px;
        }
        .aeo-cta-desc {
          font-size: 16px;
          color: var(--text-2);
          font-weight: 300;
          line-height: 1.7;
          margin-bottom: 36px;
        }

        /* ---------- FAQ ---------- */
        .aeo-faq-list { margin-top: 48px; display: flex; flex-direction: column; gap: 1px; }
        .aeo-faq-item {
          background: var(--bg-2);
          border: 1px solid var(--border);
          border-radius: 10px;
          overflow: hidden;
          transition: border-color 0.2s;
        }
        .aeo-faq-item:hover { border-color: var(--border-2); }
        .aeo-faq-q {
          width: 100%;
          background: none;
          border: none;
          padding: 24px 28px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          cursor: pointer;
          text-align: left;
        }
        .aeo-faq-q-text {
          font-size: 15px;
          font-weight: 500;
          color: var(--text);
          letter-spacing: -0.01em;
        }
        .aeo-faq-chevron {
          flex-shrink: 0;
          width: 20px;
          height: 20px;
          color: var(--text-3);
          transition: transform 0.3s, color 0.2s;
        }
        .aeo-faq-item.open .aeo-faq-chevron { transform: rotate(180deg); color: var(--em); }
        .aeo-faq-a {
          padding: 0 28px;
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.35s cubic-bezier(0.4,0,0.2,1), padding 0.3s;
          font-size: 14px;
          line-height: 1.75;
          color: var(--text-2);
          font-weight: 300;
        }
        .aeo-faq-item.open .aeo-faq-a { max-height: 200px; padding: 0 28px 24px; }
        .aeo-faq-num {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-3);
          flex-shrink: 0;
          width: 28px;
        }

        /* ---------- related ---------- */
        .aeo-related {
          border-top: 1px solid var(--border);
          padding: 48px 32px;
          background: var(--bg-2);
        }
        .aeo-related-inner {
          max-width: 1100px;
          margin: 0 auto;
        }
        .aeo-related-label {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.1em;
          color: var(--text-3);
          text-transform: uppercase;
          margin-bottom: 20px;
        }
        .aeo-related-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .aeo-related-pill {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 18px;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 8px;
          text-decoration: none;
          transition: all 0.2s;
        }
        .aeo-related-pill:hover {
          background: var(--em-dim);
          border-color: var(--em-mid);
        }
        .aeo-related-pill:hover .aeo-related-abbr { color: var(--em); }
        .aeo-related-abbr {
          font-family: var(--mono);
          font-size: 13px;
          font-weight: 500;
          color: var(--text);
          transition: color 0.2s;
        }
        .aeo-related-sub {
          font-size: 12px;
          color: var(--text-3);
        }

        /* ---------- responsive ---------- */
        @media (max-width: 768px) {
          .aeo-platforms-grid { grid-template-columns: repeat(2, 1fr); }
          .aeo-tactics-grid   { grid-template-columns: 1fr; }
          .aeo-compare        { grid-template-columns: 1fr; }
          .aeo-nav-links a:not(.aeo-btn-primary) { display: none; }
        }
      `}</style>

      <div className="aeo-root">

        {/* ── NAV ── */}
        <nav className="aeo-nav">
          <div className="aeo-nav-inner">
            <Link href="/" className="aeo-logo">
              Opti<em>AI</em>SEO
            </Link>
            <div className="aeo-nav-links">
              <Link href="/pricing" className="aeo-nav-link">Pricing</Link>
              <Link href="/free/seo-checker" className="aeo-nav-link">Free Audit</Link>
              <Link href="/signup" className="aeo-btn-primary">
                Start Free
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          </div>
        </nav>

        {/* ── HERO ── */}
        <section className="aeo-hero">
          <div className="aeo-grid-bg" />
          <div className="aeo-hero-orb-1" />
          <div className="aeo-hero-orb-2" />

          <nav aria-label="Breadcrumb" className="aeo-breadcrumb">
            <Link href="/">Home</Link>
            <span style={{ color: "var(--text-3)" }}>/</span>
            <span style={{ color: "var(--em)" }}>AEO</span>
          </nav>

          <div className="aeo-pill">
            <span className="aeo-pill-dot" />
            2026 Strategy — Win Position Zero
          </div>

          <h1 className="aeo-h1">
            Answer Engine<br />
            Optimization <em>(AEO)</em>
          </h1>

          <p className="aeo-hero-sub">
            Structure your content so AI answer engines cite you first. Win featured snippets, AI answer boxes, and voice search — before any competitor link.
          </p>

          <div className="aeo-hero-ctas">
            <Link href="/free/seo-checker" className="aeo-btn-em">
              Run Your Free AEO Audit
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3.5 8h9M8 3.5L12.5 8 8 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link href="/signup" className="aeo-btn-ghost">
              Start for Free — No Credit Card
            </Link>
          </div>
        </section>

        {/* ── PLATFORM SCORES ── */}
        <div className="aeo-platforms">
          <div className="aeo-platforms-inner">
            <p className="aeo-platforms-label">Live citation tracking across AI platforms</p>
            <div className="aeo-platforms-grid">
              {PLATFORMS.map(({ name, score }) => (
                <div key={name} className="aeo-platform-card">
                  <p className="aeo-platform-name">{name}</p>
                  <p className="aeo-platform-score">{score}</p>
                  <div className="aeo-platform-bar">
                    <div className="aeo-platform-bar-fill" style={{ width: `${score}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── WHAT IS AEO ── */}
        <section id="aeo-definition" className="aeo-section" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "start" }}>
          <div>
            <p className="aeo-section-label">&#47;&#47; What is AEO</p>
            <h2 className="aeo-h2">The shift from search ranking to answer ownership</h2>
            <p className="aeo-prose">
              <strong>Answer Engine Optimization (AEO)</strong> is the practice of structuring your content so AI answer engines can extract and present it as the direct answer to a user's question — without the user clicking through to your site.
            </p>
            <p className="aeo-prose" style={{ marginTop: 16 }}>
              As AI-powered answer engines replace traditional search for informational queries, AEO is becoming the most critical content strategy. Sites that master AEO get their brand in front of millions of users across Google AI Overviews, ChatGPT, Perplexity, and voice search assistants.
            </p>
          </div>

          <div className="aeo-compare">
            <div className="aeo-compare-col seo">
              <span className="aeo-compare-tag seo">Traditional SEO</span>
              <p className="aeo-compare-title">Rank in the list</p>
              <p className="aeo-compare-desc">Pages compete for one of ten blue links. Users click through to find answers.</p>
              <div className="aeo-compare-items seo">
                {["Keyword density focus", "Click-through dependency", "10 blue link competition", "Page-rank algorithms"].map(item => (
                  <div key={item} className="aeo-compare-item">
                    <span className="dot" /> {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="aeo-compare-col aeo active">
              <span className="aeo-compare-tag aeo">AEO — New Standard</span>
              <p className="aeo-compare-title">Own the answer</p>
              <p className="aeo-compare-desc">AI cites your content directly. Your brand is the answer before any list.</p>
              <div className="aeo-compare-items aeo">
                {["Direct-answer formatting", "Zero-click brand presence", "Position zero ownership", "AI citation algorithms"].map(item => (
                  <div key={item} className="aeo-compare-item">
                    <span className="dot" /> {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── TACTICS ── */}
        <div className="aeo-tactics-bg">
          <div className="aeo-section">
            <p className="aeo-section-label">&#47;&#47; Core Tactics</p>
            <h2 className="aeo-h2">Six pillars of AEO</h2>
            <div className="aeo-tactics-grid">
              {TACTICS.map(({ num, icon, title, desc, impact }) => (
                <div key={title} className="aeo-tactic">
                  <p className="aeo-tactic-num">{num}</p>
                  <div className="aeo-tactic-icon" dangerouslySetInnerHTML={{ __html: icon }} />
                  <p className="aeo-tactic-title">{title}</p>
                  <p className="aeo-tactic-desc">{desc}</p>
                  <span className={`aeo-tactic-impact ${impact}`}>{impact} Impact</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── CTA BANNER ── */}
        <div className="aeo-cta-banner">
          <div className="aeo-cta-orb" />
          <div className="aeo-cta-inner">
            <p className="aeo-cta-eyebrow">&#47;&#47; Auto-inject schemas</p>
            <h2 className="aeo-cta-title">
              Deploy AEO schemas across your entire site — no developer needed
            </h2>
            <p className="aeo-cta-desc">
              OptiAISEO scans your site, identifies missing FAQPage, HowTo, and Article schemas, and deploys fixes via GitHub PR in minutes.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/signup" className="aeo-btn-em">
                Start Free — No Credit Card
              </Link>
              <Link href="/free/seo-checker" className="aeo-btn-ghost">
                Run a Quick Audit
              </Link>
            </div>
          </div>
        </div>

        {/* ── FAQ ── */}
        <section className="aeo-section">
          <p className="aeo-section-label">&#47;&#47; FAQ</p>
          <h2 className="aeo-h2">Common questions about AEO</h2>
          <div className="aeo-faq-list" id="faq-list">
            {FAQS.map(({ q, a }, i) => (
              <div key={q} className="aeo-faq-item" id={`faq-${i}`}>
                <button
                  className="aeo-faq-q"
                  onClick={undefined}
                  aria-expanded="false"
                  data-faq-index={i}
                >
                  <span className="aeo-faq-num">0{i + 1}</span>
                  <span className="aeo-faq-q-text">{q}</span>
                  <svg className="aeo-faq-chevron" viewBox="0 0 20 20" fill="none">
                    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <p className="aeo-faq-a">{a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── RELATED ── */}
        <div className="aeo-related">
          <div className="aeo-related-inner">
            <p className="aeo-related-label">&#47;&#47; Related disciplines</p>
            <div className="aeo-related-list">
              {RELATED.map(({ label, sub, href }) => (
                <Link key={href} href={href} className="aeo-related-pill">
                  <span className="aeo-related-abbr">{label}</span>
                  <span className="aeo-related-sub">{sub}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <SiteFooter />
      </div>

      {/* FAQ accordion — plain JS, no framework dependency */}
      <script dangerouslySetInnerHTML={{
        __html: `
        (function () {
          document.querySelectorAll('[data-faq-index]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var item = btn.closest('.aeo-faq-item');
              var isOpen = item.classList.contains('open');
              // close all
              document.querySelectorAll('.aeo-faq-item').forEach(function (el) { el.classList.remove('open'); });
              // toggle clicked
              if (!isOpen) item.classList.add('open');
            });
          });
        })();
      `}} />
    </>
  );
}