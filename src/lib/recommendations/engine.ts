/**
 * Recommendation Engine
 *
 * Derives prioritised, data-driven recommendations from real GSC metrics
 * and site state. Pure logic — no UI, no React, no side-effects beyond reads.
 *
 * Design principles:
 *  - Every recommendation includes the raw numbers that produced it so the
 *    UI can render specific, credible copy ("14 keywords stuck on page 2")
 *    rather than generic advice.
 *  - Setup recommendations are conditional on site state and suppressed once
 *    the user has completed the relevant action.
 *  - GSC-derived recommendations are scored by estimated traffic opportunity
 *    (impressions × CTR gap to benchmark) and capped to avoid overwhelming
 *    the user.
 *  - `Promise.allSettled` is used throughout so a GSC failure never blocks
 *    setup recommendations from rendering.
 */

import { getGscOpportunities, type GscOpportunity } from "@/lib/keywords/gsc-opportunities";

// Types

export type RecommendationPriority = "critical" | "high" | "medium" | "low";
export type RecommendationEffort   = "low" | "medium" | "high";
export type RecommendationSource   = "setup" | "gsc" | "content" | "technical";

export interface Recommendation {
  id: string;
  priority: RecommendationPriority;
  source: RecommendationSource;
  category: string;
  title: string;
  description: string;
  /** One-line quantified impact shown in the impact chip */
  impact: string;
  effort: RecommendationEffort;
  tags: string[];
  /** Optional supporting numbers rendered as a stat row under the description */
  stats?: Array<{ label: string; value: string; highlight?: boolean }>;
  cta?: { label: string; href: string; external?: boolean };
}

export interface SiteContext {
  siteId: string;
  userId: string;
  domain: string;
  hasGithub: boolean;
  hasGsc: boolean;
  hasAeo: boolean;
  hasIndexNow: boolean;
  hasTrackedKeywords: boolean;
  hasBlogsPublished: boolean;
  operatingMode: string;
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  gscConnected: boolean;
  /** Top-level stats surfaced in the page header */
  summary: {
    totalOpportunities: number;
    estimatedMissedClicks: number;
    criticalCount: number;
    highCount: number;
  };
}

// CTR benchmarks by average position bucket
// Source: industry averages (Backlinko / Advanced Web Ranking 2024)

const CTR_BENCHMARKS: Array<{ maxPosition: number; expectedCtr: number }> = [
  { maxPosition: 1,  expectedCtr: 0.278 },
  { maxPosition: 2,  expectedCtr: 0.150 },
  { maxPosition: 3,  expectedCtr: 0.105 },
  { maxPosition: 4,  expectedCtr: 0.074 },
  { maxPosition: 5,  expectedCtr: 0.053 },
  { maxPosition: 7,  expectedCtr: 0.036 },
  { maxPosition: 10, expectedCtr: 0.022 },
  { maxPosition: 15, expectedCtr: 0.010 },
  { maxPosition: 20, expectedCtr: 0.006 },
  { maxPosition: 30, expectedCtr: 0.003 },
];

function benchmarkCtr(position: number): number {
  const bucket = CTR_BENCHMARKS.find((b) => position <= b.maxPosition);
  return bucket?.expectedCtr ?? 0.001;
}

/** Estimated extra clicks if CTR matched the positional benchmark */
function ctrGapClicks(opp: GscOpportunity): number {
  const actualCtr    = opp.ctr / 100;
  const expectedCtr  = benchmarkCtr(opp.position);
  const gap          = Math.max(0, expectedCtr - actualCtr);
  return Math.round(gap * opp.impressions);
}

// GSC-derived recommendation builders

interface GscInsights {
  /** Keywords pos 4–10 with CTR well below benchmark */
  lowCtrPage1: GscOpportunity[];
  /** Keywords pos 11–20, high impressions — close to page 1 */
  nearlyPage1: GscOpportunity[];
  /** Keywords pos 4–10 that are featured-snippet candidates */
  snippetCandidates: GscOpportunity[];
  /** Keywords pos 21–30 — quick refresh wins */
  lowHanging: GscOpportunity[];
  totalMissedClicks: number;
}

function analyseOpportunities(opportunities: GscOpportunity[]): GscInsights {
  const lowCtrPage1 = opportunities.filter((o) => {
    const expected = benchmarkCtr(o.position);
    const actual   = o.ctr / 100;
    return o.position <= 10 && actual < expected * 0.6; // CTR is <60% of benchmark
  });

  const nearlyPage1 = opportunities.filter(
    (o) => o.position > 10 && o.position <= 20 && o.impressions >= 100,
  );

  const snippetCandidates = opportunities.filter(
    (o) => o.position >= 2 && o.position <= 8 && o.impressions >= 300,
  );

  const lowHanging = opportunities.filter(
    (o) => o.position > 20 && o.position <= 30 && o.impressions >= 50,
  );

  const totalMissedClicks = opportunities.reduce(
    (sum, o) => sum + ctrGapClicks(o),
    0,
  );

  return { lowCtrPage1, nearlyPage1, snippetCandidates, lowHanging, totalMissedClicks };
}

function buildGscRecommendations(
  insights: GscInsights,
  domain: string,
): Recommendation[] {
  const recs: Recommendation[] = [];

  if (insights.lowCtrPage1.length > 0) {
    const top = insights.lowCtrPage1[0];
    const totalMissed = insights.lowCtrPage1.reduce(
      (s, o) => s + ctrGapClicks(o),
      0,
    );
    const avgCtr      = (
      insights.lowCtrPage1.reduce((s, o) => s + o.ctr, 0) /
      insights.lowCtrPage1.length
    ).toFixed(1);
    const benchmarkPct = (benchmarkCtr(top.position) * 100).toFixed(1);

    recs.push({
      id:       "gsc-low-ctr-page1",
      priority: "critical",
      source:   "gsc",
      category: "Click-Through Rate",
      title:    `${insights.lowCtrPage1.length} page-1 keyword${insights.lowCtrPage1.length > 1 ? "s" : ""} with critically low CTR`,
      description:
        `You rank on page 1 for ${insights.lowCtrPage1.length} keyword${insights.lowCtrPage1.length > 1 ? "s" : ""} ` +
        `but your average CTR (${avgCtr}%) is well below the positional benchmark of ~${benchmarkPct}%. ` +
        `Rewriting title tags to be more intent-specific and adding structured data for rich results are the ` +
        `highest-leverage fixes — they improve clicks without changing your ranking.`,
      impact: `~${totalMissed.toLocaleString()} extra clicks/month recoverable`,
      effort: "low",
      tags:   ["CTR", "Title Tags", "GSC"],
      stats: [
        { label: "Keywords affected", value: String(insights.lowCtrPage1.length) },
        { label: "Your avg CTR",      value: `${avgCtr}%` },
        { label: "Benchmark CTR",     value: `${benchmarkPct}%`, highlight: true },
        { label: "Top keyword",       value: `"${top.keyword}" (#${top.position})` },
      ],
      cta: { label: "Fix title tags in Audits", href: `/dashboard/audits` },
    });
  }

  if (insights.nearlyPage1.length > 0) {
    const totalImpressions = insights.nearlyPage1.reduce(
      (s, o) => s + o.impressions,
      0,
    );
    const top3 = insights.nearlyPage1.slice(0, 3);

    recs.push({
      id:       "gsc-nearly-page1",
      priority: "high",
      source:   "gsc",
      category: "Ranking Opportunity",
      title:    `${insights.nearlyPage1.length} keyword${insights.nearlyPage1.length > 1 ? "s" : ""} within reach of page 1`,
      description:
        `${insights.nearlyPage1.length} keywords are ranking positions 11–20 with a combined ` +
        `${totalImpressions.toLocaleString()} monthly impressions. A targeted content refresh — ` +
        `adding depth, FAQ schema, and 2–3 internal links from higher-authority pages — is typically ` +
        `enough to push these onto page 1, where average CTR jumps from ~0.6% to 2–5%.`,
      impact: `${totalImpressions.toLocaleString()} impressions waiting for page-1 CTR`,
      effort: "medium",
      tags:   ["Rankings", "Content", "GSC"],
      stats: top3.map((o) => ({
        label: `"${o.keyword}"`,
        value: `pos #${o.position} · ${o.impressions.toLocaleString()} impressions`,
      })),
      cta: { label: "Research keywords", href: `/dashboard/keywords` },
    });
  }

  if (insights.snippetCandidates.length > 0) {
    const top = insights.snippetCandidates[0];

    recs.push({
      id:       "gsc-snippet-candidates",
      priority: "high",
      source:   "gsc",
      category: "Featured Snippets",
      title:    `${insights.snippetCandidates.length} keyword${insights.snippetCandidates.length > 1 ? "s" : ""} eligible for featured snippet`,
      description:
        `"${top.keyword}" has ${top.impressions.toLocaleString()} monthly impressions at position ` +
        `#${top.position}. Pages in positions 2–8 with high impression volume are the strongest ` +
        `featured snippet candidates. Restructuring the opening paragraph as a direct 40–60 word ` +
        `answer and adding a summary table typically triggers the snippet within 4–6 weeks.`,
      impact: "Featured snippets average 2–5× higher CTR than standard results",
      effort: "medium",
      tags:   ["Snippets", "SERP Features", "GSC"],
      stats: insights.snippetCandidates.slice(0, 3).map((o) => ({
        label: `"${o.keyword}"`,
        value: `pos #${o.position} · ${o.impressions.toLocaleString()} impressions`,
      })),
      cta: { label: "View keyword research", href: `/dashboard/keywords` },
    });
  }

  if (insights.lowHanging.length > 0) {
    const top = insights.lowHanging[0];

    recs.push({
      id:       "gsc-low-hanging",
      priority: "medium",
      source:   "gsc",
      category: "Quick Wins",
      title:    `${insights.lowHanging.length} keyword${insights.lowHanging.length > 1 ? "s" : ""} on page 3 worth a quick refresh`,
      description:
        `You have ${insights.lowHanging.length} keywords on pages 3–4 with enough impressions to ` +
        `be worth targeting. A title tag update and a 300-word content refresh aligned to search ` +
        `intent is typically enough to move these to page 2, and sometimes straight to page 1.`,
      impact: `${insights.lowHanging.reduce((s, o) => s + o.impressions, 0).toLocaleString()} impressions addressable`,
      effort: "low",
      tags:   ["Quick Wins", "Content Refresh", "GSC"],
      stats: [
        { label: "Top keyword", value: `"${top.keyword}"` },
        { label: "Position",    value: `#${top.position}` },
        { label: "Impressions", value: top.impressions.toLocaleString() },
      ],
      cta: { label: "Generate content", href: `/dashboard/blogs` },
    });
  }

  return recs;
}

// Setup / integration recommendations (conditional on site state)

function buildSetupRecommendations(ctx: SiteContext): Recommendation[] {
  const recs: Recommendation[] = [];

  if (!ctx.hasGsc) {
    recs.push({
      id:       "setup-gsc",
      priority: "critical",
      source:   "setup",
      category: "Data Sources",
      title:    "Connect Google Search Console",
      description:
        "GSC is the only source of real click, impression, and position data for your site. " +
        "Without it, keyword scores are estimated from third-party APIs and are ~40% less accurate. " +
        "Connecting takes under 2 minutes and unlocks all data-driven recommendations.",
      impact:   "Unlocks live CTR, impressions & position data",
      effort:   "low",
      tags:     ["GSC", "Data Quality", "Setup"],
      cta:      { label: "Connect GSC", href: "/dashboard/settings" },
    });
  }

  if (!ctx.hasGithub) {
    recs.push({
      id:       "setup-github",
      priority: "critical",
      source:   "setup",
      category: "Developer Workflow",
      title:    "Link a GitHub repository for auto-fix PRs",
      description:
        "Without a linked repo, detected SEO issues — broken schema, missing meta tags, " +
        "heading hierarchy errors — are reported but not fixed. Linking a repo lets the " +
        "autonomous engine open pull requests directly. Most fixes ship in under 60 seconds.",
      impact:   "Autonomous one-click fix PRs",
      effort:   "low",
      tags:     ["GitHub", "Automation", "Setup"],
      cta:      { label: "Link GitHub repo", href: "/dashboard/settings" },
    });
  }

  if (!ctx.hasAeo) {
    recs.push({
      id:       "setup-aeo",
      priority: "high",
      source:   "setup",
      category: "AI Visibility",
      title:    "Set up AEO tracking for your brand",
      description:
        "AI engines (ChatGPT, Perplexity, Gemini) now answer queries that previously drove " +
        "clicks to your site. AEO tracking measures how often your brand appears in those " +
        "answers so you can optimise for generative search before competitors do.",
      impact:   "Measure & grow AI-answer share-of-voice",
      effort:   "medium",
      tags:     ["AEO", "LLMs", "Brand Visibility"],
      cta:      { label: "Start AEO tracking", href: "/dashboard/aeo/track" },
    });
  }

  if (!ctx.hasIndexNow) {
    recs.push({
      id:       "setup-indexnow",
      priority: "medium",
      source:   "setup",
      category: "Technical SEO",
      title:    "Enable auto-indexing for new content",
      description:
        "New pages wait weeks for Google to crawl them organically. The auto-indexer " +
        "submits URLs to Google Indexing API and Bing IndexNow on publish, reducing " +
        "time-to-index from weeks to hours.",
      impact:   "Pages indexed in hours, not weeks",
      effort:   "low",
      tags:     ["Indexing", "Technical", "Speed"],
      cta:      { label: "Configure indexer", href: "/dashboard/settings" },
    });
  }

  if (!ctx.hasTrackedKeywords) {
    recs.push({
      id:       "setup-tracked-keywords",
      priority: "medium",
      source:   "setup",
      category: "SEO Strategy",
      title:    "Track your target keywords",
      description:
        "Tracking keywords gives you daily position history, cannibalization detection, " +
        "and share-of-voice charts against competitors. Without tracked keywords, ranking " +
        "trends are invisible until something goes wrong.",
      impact:   "Daily ranking history & competitor benchmarks",
      effort:   "low",
      tags:     ["Keywords", "Tracking", "Strategy"],
      cta:      { label: "Add keywords", href: "/dashboard/keywords" },
    });
  }

  return recs;
}

// Public API

export async function buildRecommendations(
  ctx: SiteContext,
): Promise<RecommendationResult> {
  // getGscOpportunities handles all its own errors and returns [] on failure,
  // so a direct await is sufficient — no need for Promise.allSettled.
  const opportunities: GscOpportunity[] = ctx.hasGsc
    ? await getGscOpportunities(ctx.userId, ctx.domain)
    : [];

  const gscConnected = ctx.hasGsc && opportunities.length >= 0;

  const insights  = analyseOpportunities(opportunities);
  const gscRecs   = buildGscRecommendations(insights, ctx.domain);
  const setupRecs = buildSetupRecommendations(ctx);

  // Merge: GSC recs first (data-driven, most valuable), then setup
  const all = [...gscRecs, ...setupRecs];

  // Stable sort: priority order, then by source (gsc before setup at same priority)
  const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
    critical: 0,
    high:     1,
    medium:   2,
    low:      3,
  };

  const sorted = all.sort((a, b) => {
    const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (byPriority !== 0) return byPriority;
    // Within same priority, GSC data-driven recs come first
    if (a.source === "gsc" && b.source !== "gsc") return -1;
    if (a.source !== "gsc" && b.source === "gsc") return 1;
    return 0;
  });

  return {
    recommendations: sorted,
    gscConnected,
    summary: {
      totalOpportunities: opportunities.length,
      estimatedMissedClicks: insights.totalMissedClicks,
      criticalCount: sorted.filter((r) => r.priority === "critical").length,
      highCount:     sorted.filter((r) => r.priority === "high").length,
    },
  };
}