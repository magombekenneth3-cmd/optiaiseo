"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  List,
  ChevronRight,
  Clock,
  Calendar,
  User,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Shield,
  Layers,
} from "lucide-react";

export interface TocItem {
  id: string;
  label: string;
}

export interface ComparisonRow {
  tool: string;
  bestFor: string;
  gui: boolean;
  js: boolean;
  largeCrawls: boolean;
  developerApi: boolean;
  strength: string;
  tradeoff: string;
}

export interface EditorialBlogLayoutProps {
  category: string;
  title: string;
  subtitle: string;
  authorName?: string;
  updatedDate: string;
  readTime: string;
  keyTakeaways: Array<{ tool: string; summary: string }>;
  toc: TocItem[];
  comparisonTable?: ComparisonRow[];
  children: React.ReactNode;
}

export function EditorialBlogLayout({
  category,
  title,
  subtitle,
  authorName = "OptiAISEO Editorial Team",
  updatedDate,
  readTime,
  keyTakeaways,
  toc,
  comparisonTable,
  children,
}: EditorialBlogLayoutProps) {
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState<string>("");

  return (
    <article className="min-h-screen bg-background text-foreground selection:bg-emerald-500/30">
      {/* Sticky Public Header CTA */}
      <header className="sticky top-0 z-40 w-full border-b border-border/80 bg-background/95 backdrop-blur-md px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-sm tracking-tight">
          <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center text-black font-black text-xs">
            O
          </div>
          <span>OptiAISEO <span className="text-xs text-muted-foreground font-normal">Blog</span></span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/audits"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition-all shadow-md shadow-emerald-500/15"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Start Free SEO Audit
          </Link>
        </div>
      </header>

      {/* Hero Editorial Header */}
      <header className="max-w-4xl mx-auto px-4 pt-12 pb-8 text-center flex flex-col items-center gap-4">
        {/* Category Eyebrow */}
        <span className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
          {category}
        </span>

        {/* Article H1 Title */}
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground leading-[1.15] max-w-3xl">
          {title}
        </h1>

        {/* Subtitle / Descriptor */}
        <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl leading-relaxed font-normal">
          {subtitle}
        </p>

        {/* Meta Byline */}
        <div className="flex items-center justify-center flex-wrap gap-4 text-xs text-muted-foreground pt-3 border-t border-border/40 w-full max-w-md mt-2">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <User className="w-3.5 h-3.5 text-emerald-400" />
            By {authorName}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            Updated {updatedDate}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {readTime}
          </span>
        </div>

        {/* Start Audit CTA Button */}
        <div className="pt-2">
          <Link
            href="/dashboard/audits"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-bold shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
          >
            Start Free SEO Audit
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </header>

      {/* Key Takeaways Box (Before asking readers to read 3,000 words) */}
      {keyTakeaways && keyTakeaways.length > 0 && (
        <section className="max-w-3xl mx-auto px-4 mb-10">
          <div className="p-6 rounded-2xl bg-card border border-emerald-500/30 shadow-lg shadow-emerald-500/5 relative overflow-hidden">
            <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4" />
              Key Takeaway Summary
            </h3>
            <ul className="space-y-2 text-sm text-foreground">
              {keyTakeaways.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span className="font-bold text-emerald-400 shrink-0">→</span>
                  <span>
                    <strong className="text-foreground">{item.tool}:</strong>{" "}
                    <span className="text-muted-foreground">{item.summary}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Main Body Layout with Desktop Left-Rail TOC + Mobile TOC Drawer */}
      <div className="max-w-6xl mx-auto px-4 pb-20 flex flex-col lg:flex-row gap-10 items-start relative">
        {/* Mobile TOC Drawer Toggle */}
        <div className="lg:hidden w-full sticky top-14 z-30 bg-background/95 backdrop-blur border-b border-border py-2">
          <button
            type="button"
            onClick={() => setMobileTocOpen(!mobileTocOpen)}
            className="flex items-center justify-between w-full px-4 py-2 rounded-xl bg-card border border-border text-xs font-bold text-foreground"
          >
            <span className="flex items-center gap-2">
              <List className="w-4 h-4 text-emerald-400" />
              On this page
            </span>
            <ChevronRight className={`w-4 h-4 transition-transform ${mobileTocOpen ? "rotate-90" : ""}`} />
          </button>

          {mobileTocOpen && (
            <nav className="p-4 mt-2 rounded-xl bg-card border border-border space-y-2 text-xs">
              {toc.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={() => setMobileTocOpen(false)}
                  className="block text-muted-foreground hover:text-emerald-400 transition-colors py-1"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          )}
        </div>

        {/* Desktop Sticky Left Rail TOC */}
        <aside className="hidden lg:block w-64 shrink-0 sticky top-20 text-xs self-start">
          <div className="p-4 rounded-2xl bg-card/60 border border-border/80 space-y-3">
            <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <List className="w-3.5 h-3.5 text-emerald-400" />
              On this page
            </h4>
            <nav className="space-y-1.5 border-l border-border pl-3">
              {toc.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="block text-muted-foreground hover:text-foreground hover:translate-x-0.5 transition-all py-1 font-medium"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Article Body Content */}
        <main className="flex-1 min-w-0 max-w-3xl prose dark:prose-invert prose-emerald">
          {children}

          {/* Useful Comparison Table component if passed */}
          {comparisonTable && comparisonTable.length > 0 && (
            <div className="my-10 overflow-x-auto not-prose">
              <h3 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                <Layers className="w-5 h-5 text-emerald-400" />
                Feature &amp; Capability Comparison
              </h3>
              <table className="w-full text-xs text-left border-collapse rounded-xl overflow-hidden bg-card border border-border">
                <thead className="bg-muted/60 text-muted-foreground font-bold uppercase tracking-wider border-b border-border">
                  <tr>
                    <th className="p-3">Tool</th>
                    <th className="p-3">Best for</th>
                    <th className="p-3 text-center">GUI</th>
                    <th className="p-3 text-center">JS</th>
                    <th className="p-3 text-center">Large Crawls</th>
                    <th className="p-3 text-center">API</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {comparisonTable.map((row, idx) => (
                    <React.Fragment key={idx}>
                      <tr className="hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-bold text-foreground">{row.tool}</td>
                        <td className="p-3 text-muted-foreground font-medium">{row.bestFor}</td>
                        <td className="p-3 text-center font-bold text-emerald-400">{row.gui ? "✓" : "—"}</td>
                        <td className="p-3 text-center font-bold text-emerald-400">{row.js ? "✓" : "—"}</td>
                        <td className="p-3 text-center font-bold text-emerald-400">{row.largeCrawls ? "✓" : "—"}</td>
                        <td className="p-3 text-center font-bold text-emerald-400">{row.developerApi ? "✓" : "—"}</td>
                      </tr>
                      <tr className="bg-muted/10 text-[11px]">
                        <td colSpan={6} className="px-3 py-2 text-muted-foreground">
                          <strong className="text-foreground">Strength:</strong> {row.strength} &nbsp;|&nbsp;{" "}
                          <strong className="text-foreground">Tradeoff:</strong> {row.tradeoff}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </article>
  );
}
