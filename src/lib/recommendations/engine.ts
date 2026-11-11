/**
 * Recommendation Engine — Phase 3 (DB-backed Persistent Opportunities)
 *
 * Derives prioritised, data-driven recommendations from PostgreSQL GrowthDecision records
 * and site setup state.
 *
 * Primary Source: Reads persisted GrowthDecision objects from PostgreSQL.
 * Fallback: If no decisions exist in DB for a site, triggers runGrowthDecisionPipeline.
 */

import { getPersistedDecisions } from "@/lib/growth/decision-persistence";
import type { GrowthDecision, ExplainableScore } from "@/lib/opportunity-engine/types";
import { runGrowthDecisionPipeline } from "@/lib/opportunity-engine";
import { generateLlmOptimizationRules } from "@/lib/aeo/llm-recommendations";
import { prisma } from "@/lib/prisma";
import { parseAuditResult, toNormalisedIssues } from "@/lib/seo-audit/parse-audit-result";

export type RecommendationPriority = "critical" | "high" | "medium" | "low";
export type RecommendationEffort   = "low" | "medium" | "high";
export type RecommendationSource   = "setup" | "gsc" | "content" | "technical" | "llm";

export interface Recommendation {
  id: string;
  opportunityId?: string;
  priority: RecommendationPriority;
  source: RecommendationSource;
  category: string;
  title: string;
  description: string;
  impact: string;
  effort: RecommendationEffort;
  status: string;
  tags: string[];
  url?: string;
  primaryKeyword?: string;
  action?: string;
  scoreOverall?: number;
  stats?: Array<{ label: string; value: string; highlight?: boolean }>;
  whyNow?: {
    headline?: string;
    evidenceText?: string;
    gscMetrics?: {
      impressions?: number;
      clicks?: number;
      position?: number;
      previousPosition?: number;
      trend?: number;
    };
  };
  executionPlan?: Array<{ step: number; action: string; expectedOutcome: string }>;
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
  summary: {
    totalOpportunities: number;
    estimatedMissedClicks: number;
    criticalCount: number;
    highCount: number;
    monitoringCount: number;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function mapScoreToPriority(score: ExplainableScore): RecommendationPriority {
  const s = score.final;
  if (s >= 75) return "critical";
  if (s >= 55) return "high";
  if (s >= 35) return "medium";
  return "low";
}

function mapScoreToEffort(score: ExplainableScore): RecommendationEffort {
  const e = score.effort;
  if (e <= 30) return "low";
  if (e <= 60) return "medium";
  return "high";
}

function formatCategoryTitle(category: string): string {
  switch (category) {
    case "QUICK_WIN":        return "Quick Win Opportunity";
    case "ALMOST_RANKING":   return "Page-2 Ranking Opportunity";
    case "DECLINING":        return "Traffic Loss Recovery";
    case "STALE":            return "Content Refresh Target";
    case "ORPHANED":         return "Internal Linking Target";
    case "CANNIBALIZATION":  return "Cannibalization Fix";
    case "DEAD_WEIGHT":      return "Dead Weight Cleanup";
    default:                 return category.replace(/_/g, " ");
  }
}

function urgencyToHeadline(dec: GrowthDecision): string {
  const actionLabel = dec.action.replace(/_/g, " ").toLowerCase();
  return `${dec.whyNow.urgency === "CRITICAL" ? "⚠ " : ""}${actionLabel} — "${dec.primaryKeyword}"`;
}

function signalsToEvidenceText(dec: GrowthDecision): string {
  if (dec.whyNow.signals.length === 0) {
    return `Opportunity detected for keyword "${dec.primaryKeyword}" on ${dec.url}.`;
  }
  return dec.whyNow.signals.map((s) => s.evidence).join(" ");
}

// ────────────────────────────────────────────────────────────────────────────
// Recommendation builders
// ────────────────────────────────────────────────────────────────────────────

function buildLlmRecommendations(domain: string): Recommendation[] {
  const rules = generateLlmOptimizationRules(domain);
  return rules.map((r) => ({
    id: r.id,
    priority: (r.estimatedImpact.toLowerCase() as RecommendationPriority) || "medium",
    source: "llm",
    category: "LLM Optimization",
    title: r.title,
    description: r.rule,
    impact: `Targeting: ${r.targetLLMs.join(", ")}`,
    effort: "medium" as RecommendationEffort,
    status: "ACTIVE",
    tags: ["LLM", "RAG", "Scrapers", "AEO"],
    cta: { label: "View AEO Audit", href: "/dashboard/aeo" },
  }));
}

function buildSetupRecommendations(ctx: SiteContext): Recommendation[] {
  const recs: Recommendation[] = [];

  if (!ctx.hasGsc) {
    recs.push({
      id: "setup-gsc", priority: "critical", source: "setup",
      category: "Data Sources", title: "Connect Google Search Console",
      description: "GSC is the primary source of search performance data. Connecting GSC enables automated opportunity detection and experiment tracking.",
      impact: "Unlocks live CTR, impressions & position data",
      effort: "low", status: "ACTIVE",
      tags: ["GSC", "Data Quality", "Setup"],
      cta: { label: "Connect GSC", href: "/dashboard" },
    });
  }

  if (!ctx.hasGithub) {
    recs.push({
      id: "setup-github", priority: "high", source: "setup",
      category: "Developer Workflow", title: "Link a GitHub repository for automated fixes",
      description: "Linking a GitHub repo enables autonomous pull requests for technical, schema, and meta tag optimizations.",
      impact: "Autonomous one-click fix PRs",
      effort: "low", status: "ACTIVE",
      tags: ["GitHub", "Automation", "Setup"],
      cta: { label: "Link GitHub repo", href: "/dashboard/settings" },
    });
  }

  if (!ctx.hasAeo) {
    recs.push({
      id: "setup-aeo", priority: "medium", source: "setup",
      category: "AI Visibility", title: "Set up AEO tracking for your brand",
      description: "Monitor how generative AI engines (ChatGPT, Perplexity, Gemini) reference your site.",
      impact: "Measure & grow AI-answer share-of-voice",
      effort: "medium", status: "ACTIVE",
      tags: ["AEO", "LLMs", "Brand Visibility"],
      cta: { label: "Start AEO tracking", href: "/dashboard/aeo/track" },
    });
  }

  return recs;
}

// ────────────────────────────────────────────────────────────────────────────
// Core: GrowthDecision → Recommendation mapping
// ────────────────────────────────────────────────────────────────────────────

function decisionToRecommendation(dec: GrowthDecision): { rec: Recommendation; estimatedLift: number } {
  const priority = mapScoreToPriority(dec.score);
  const effort   = mapScoreToEffort(dec.score);

  const categoryTitle = formatCategoryTitle(dec.primaryCategory);
  const headline      = urgencyToHeadline(dec);
  const evidenceText  = signalsToEvidenceText(dec);

  // Traffic potential from the deterministic impact model
  const expectedTraffic = dec.impact.trafficPotential.expected;
  const confidence      = dec.impact.trafficPotential.confidence;

  const stats: Array<{ label: string; value: string; highlight?: boolean }> = [
    { label: "Target Query", value: `"${dec.primaryKeyword}"` },
    { label: "Score", value: `${dec.score.final}/100`, highlight: dec.score.final >= 75 },
    { label: "Traffic Potential", value: `${expectedTraffic} clicks/mo (${confidence}% conf)` },
    { label: "Urgency", value: dec.whyNow.urgency },
  ];

  // Add signal summaries
  for (const sig of dec.whyNow.signals.slice(0, 2)) {
    stats.push({ label: sig.signal.replace(/_/g, " "), value: sig.severity });
  }

  const rec: Recommendation = {
    id: dec.id,
    opportunityId: dec.id,
    priority,
    source: "gsc",
    category: categoryTitle,
    title: headline,
    description: evidenceText,
    impact: `~${expectedTraffic} extra clicks/mo expected (${dec.impact.trafficPotential.low}–${dec.impact.trafficPotential.high} range)`,
    effort,
    status: dec.status ?? "ACTIVE",
    tags: [dec.primaryCategory, dec.action, "GSC"],
    url: dec.url,
    primaryKeyword: dec.primaryKeyword,
    action: dec.action,
    scoreOverall: dec.score.final,
    stats,
    whyNow: {
      headline,
      evidenceText,
      gscMetrics: dec.whyNow.gscMetrics,
    },
    executionPlan: dec.executionPlan,
    cta: { label: "Review Opportunity", href: `#review-${dec.id}` },
  };

  return { rec, estimatedLift: expectedTraffic };
}

async function buildAuditRecommendations(ctx: SiteContext): Promise<Recommendation[]> {
  try {
    const latestAudit = await prisma.audit.findFirst({
      where: {
        siteId: ctx.siteId,
        fixStatus: { notIn: ["PENDING", "IN_PROGRESS", "FAILED"] },
      },
      orderBy: { runTimestamp: "desc" },
      select: { id: true, issueList: true },
    });
    if (!latestAudit?.issueList) return [];

    const parsed = parseAuditResult(latestAudit.issueList);
    const issues = toNormalisedIssues(parsed)
      .filter((i) => i.severity === "critical" || i.severity === "high")
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 12);

    const defaultUrl = ctx.domain.startsWith("http") ? ctx.domain : `https://${ctx.domain}`;

    return issues.map((issue): Recommendation => {
      const catLower = (issue.category ?? "").toLowerCase();
      const isContent =
        catLower.includes("content") ||
        catLower.includes("on-page") ||
        catLower.includes("onpage") ||
        catLower.includes("keyword") ||
        catLower.includes("eeat");
      const source: RecommendationSource = isContent ? "content" : "technical";
      const priority: RecommendationPriority = issue.severity === "critical" ? "critical" : "high";
      const effort: RecommendationEffort =
        catLower.includes("basics") || catLower.includes("on-page") || catLower.includes("schema")
          ? "low"
          : catLower.includes("performance") || catLower.includes("off-page")
            ? "high"
            : "medium";
      const recText = issue.recommendation || "Review and resolve this audit finding.";

      return {
        id: `audit-${latestAudit.id}-${issue.id}`,
        priority,
        source,
        category: issue.category || (isContent ? "On-Page & Content" : "Technical SEO"),
        title: issue.title || issue.id,
        description: issue.finding || issue.description || recText,
        impact: `Priority ${issue.priorityScore}/100 · ROI ${issue.roiImpact}% · AI Vis ${issue.aiVisibilityImpact}%`,
        effort,
        status: "ACTIVE",
        tags: [issue.category || "SEO Audit", issue.severity.toUpperCase()],
        url: parsed.url || defaultUrl,
        scoreOverall: issue.priorityScore,
        stats: [
          { label: "Priority Score", value: `${issue.priorityScore}/100`, highlight: issue.priorityScore >= 75 },
          { label: "ROI Impact", value: `${issue.roiImpact}%` },
          { label: "AI Visibility", value: `${issue.aiVisibilityImpact}%` },
        ],
        whyNow: {
          headline: `${issue.title || issue.id} (${issue.severity.toUpperCase()})`,
          evidenceText: issue.finding || issue.description || recText,
        },
        executionPlan: [
          {
            step: 1,
            action: recText,
            expectedOutcome: "Resolves the audit finding and improves page health score.",
          },
        ],
        cta: {
          label: "Fix in Audit Report",
          href: `/dashboard/audits/${latestAudit.id}#section-fixes`,
        },
      };
    });
  } catch {
    return [];
  }
}

export async function buildRecommendations(
  ctx: SiteContext,
): Promise<RecommendationResult> {
  let dbDecisions: GrowthDecision[] = await getPersistedDecisions(ctx.siteId, true);

  if (dbDecisions.length === 0 && ctx.hasGsc) {
    await runGrowthDecisionPipeline(ctx.siteId);
    dbDecisions = await getPersistedDecisions(ctx.siteId, true);
  }

  let totalMissedClicks = 0;
  const gscRecs: Recommendation[] = dbDecisions.map((dec) => {
    const { rec, estimatedLift } = decisionToRecommendation(dec);
    if (rec.status === "ACTIVE") {
      totalMissedClicks += estimatedLift;
    }
    return rec;
  });

  const [auditRecs, setupRecs, llmRecs] = await Promise.all([
    buildAuditRecommendations(ctx),
    Promise.resolve(buildSetupRecommendations(ctx)),
    Promise.resolve(buildLlmRecommendations(ctx.domain)),
  ]);

  const all = [...gscRecs, ...auditRecs, ...llmRecs, ...setupRecs];

  const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
    critical: 0,
    high:     1,
    medium:   2,
    low:      3,
  };

  const sorted = all.sort((a, b) => {
    const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (byPriority !== 0) return byPriority;
    if (a.source === "gsc" && b.source !== "gsc") return -1;
    if (a.source !== "gsc" && b.source === "gsc") return 1;
    if ((b.scoreOverall ?? 0) !== (a.scoreOverall ?? 0)) {
      return (b.scoreOverall ?? 0) - (a.scoreOverall ?? 0);
    }
    return 0;
  });

  return {
    recommendations: sorted,
    gscConnected: ctx.hasGsc,
    summary: {
      totalOpportunities: gscRecs.length + auditRecs.length,
      estimatedMissedClicks: totalMissedClicks,
      criticalCount: sorted.filter((r) => r.priority === "critical").length,
      highCount:     sorted.filter((r) => r.priority === "high").length,
      monitoringCount: sorted.filter((r) => r.status === "MONITORING" || r.status === "EXECUTED" || r.status === "APPROVED").length,
    },
  };
}
