"use client";

import {
  TrendingUp,
  Target,
  PenLine,
  ArrowRight,
  ChevronRight,
  Shield,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { generateBlogForKeyword } from "@/app/actions/keywords";
import { runAudit } from "@/app/actions/audit";

interface KeywordRow {
  keyword:     string;
  avgPosition: number;
  impressions: number;
  clicks:      number;
  ctr:         number;
  url?:        string;
}

interface CategorisedKeywords {
  strong:    KeywordRow[];
  improving: KeywordRow[];
  weak:      KeywordRow[];
  critical:  KeywordRow[];
}

interface OpportunityRow {
  keyword:          string;
  avgPosition:      number;
  impressions:      number;
  ctr:              number;
  opportunityScore: number;
  ctrScore?:        number;
}

interface Summary {
  total:             number;
  page1Count:        number;
  page1Pct:          number;
  avgPosition:       number;
  totalClicks:       number;
  totalImpressions:  number;
  criticalCount:     number;
  weakCount:         number;
}

type ActionState = "idle" | "loading" | "success" | "error";

function ActionButton({
  label,
  state,
  successLabel,
  href,
  onClick,
}: {
  label:         string;
  state:         ActionState;
  successLabel?: string;
  href?:         string;
  onClick?:      () => void;
}) {
  const baseClass =
    "mt-auto inline-flex items-center gap-1.5 text-xs font-semibold transition-all";

  if (state === "loading") {
    return (
      <span className={`${baseClass} text-muted-foreground cursor-not-allowed`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Working…
      </span>
    );
  }

  if (state === "success") {
    return (
      <span className={`${baseClass} text-emerald-400`}>
        <CheckCircle2 className="w-3.5 h-3.5" />
        {successLabel ?? "Done!"}
      </span>
    );
  }

  if (state === "error") {
    return (
      <button
        onClick={onClick}
        className={`${baseClass} text-rose-400 hover:opacity-80 cursor-pointer`}
      >
        <XCircle className="w-3.5 h-3.5" />
        Failed — tap to retry
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} className={`${baseClass} text-primary hover:opacity-80`}>
        {label}
        <ChevronRight className="w-3.5 h-3.5" />
      </Link>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`${baseClass} text-primary hover:opacity-80 cursor-pointer`}
    >
      {label}
      <ChevronRight className="w-3.5 h-3.5" />
    </button>
  );
}

function PlaybookCard({
  icon: Icon,
  label,
  labelColor,
  title,
  description,
  keywords,
  ctaLabel,
  ctaHref,
  ctaAction,
  ctaSuccessLabel,
  metric,
}: {
  icon:             React.ElementType;
  label:            string;
  labelColor:       string;
  title:            string;
  description:      string;
  keywords:         string[];
  ctaLabel:         string;
  ctaHref?:         string;
  ctaAction?:       () => Promise<{ success: boolean; error?: string }>;
  ctaSuccessLabel?: string;
  metric?:          { value: string; caption: string };
}) {
  const [actionState, setActionState] = useState<ActionState>("idle");
  const MAX_PILLS = 4;
  const shown    = keywords.slice(0, MAX_PILLS);
  const overflow = keywords.length - MAX_PILLS;

  const handleAction = useCallback(async () => {
    if (!ctaAction || actionState === "loading") return;
    setActionState("loading");
    try {
      const result = await ctaAction();
      setActionState(result.success ? "success" : "error");
      if (!result.success) setTimeout(() => setActionState("idle"), 4000);
    } catch {
      setActionState("error");
      setTimeout(() => setActionState("idle"), 4000);
    }
  }, [ctaAction, actionState]);

  return (
    <div className="card-surface rounded-2xl p-5 flex flex-col gap-4 border border-border hover:border-border/80 transition-colors">
      <div className="flex items-start gap-3">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-current/10 ${labelColor}`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-[10px] font-bold uppercase tracking-widest ${labelColor}`}>
            {label}
          </span>
          <p className="text-sm font-semibold mt-0.5 leading-snug">{title}</p>
        </div>
        {metric && (
          <div className="shrink-0 text-right">
            <p className="text-xl font-bold">{metric.value}</p>
            <p className="text-[10px] text-muted-foreground">{metric.caption}</p>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>

      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((kw) => (
            <span
              key={kw}
              className="inline-block text-[11px] px-2 py-0.5 rounded-md bg-accent/50 border border-border text-muted-foreground font-mono"
            >
              {kw}
            </span>
          ))}
          {overflow > 0 && (
            <span className="inline-block text-[11px] px-2 py-0.5 rounded-md bg-accent/50 border border-border text-muted-foreground">
              +{overflow} more
            </span>
          )}
        </div>
      )}

      <ActionButton
        label={ctaLabel}
        state={actionState}
        successLabel={ctaSuccessLabel}
        href={ctaAction ? undefined : ctaHref}
        onClick={ctaAction ? handleAction : undefined}
      />
    </div>
  );
}

export function KeywordPlaybookPanel({
  categorised,
  opportunities,
  summary,
  domain,
  siteId,
}: {
  categorised:   CategorisedKeywords;
  opportunities: OpportunityRow[];
  summary:       Summary;
  domain:        string;
  siteId?:       string;
}) {
  const router = useRouter();
  const { strong, improving, weak, critical } = categorised;
  const allWeak     = [...critical, ...weak];
  const topOpp      = opportunities[0];
  const totalMissed = Math.round(
    opportunities.reduce((s, o) => s + (o.ctrScore ?? 0), 0),
  );

  if (
    strong.length === 0 &&
    improving.length === 0 &&
    allWeak.length === 0 &&
    !topOpp
  ) {
    return null;
  }

  const cards: React.ReactNode[] = [];

  if (strong.length > 0) {
    const totalImpr   = strong.reduce((s, k) => s + k.impressions, 0);
    const topPath     = strong[0]?.url ?? "";
    const topAuditUrl = topPath.startsWith("http")
      ? topPath
      : `https://${domain}${topPath}`;

    const runAuditAction = async () => {
      const result = await runAudit(siteId, "full");
      if (result.success) router.push(`/dashboard/audits/${result.audit.id}`);
      return { success: result.success, error: result.success ? undefined : result.error };
    };

    cards.push(
      <PlaybookCard
        key="strong"
        icon={Shield}
        label="Protect & scale"
        labelColor="text-emerald-400"
        title={`${strong.length} top-ranking keyword${strong.length > 1 ? "s" : ""} — link from these to boost weaker pages`}
        description={`These keywords already rank on page 1 and account for ${totalImpr.toLocaleString()} impressions/month. Update these pages quarterly (add a year to the title, refresh stats), add internal links from them to pages you want to rank, and add schema markup if missing.`}
        keywords={strong.slice(0, 6).map((k) => `#${Math.round(k.avgPosition)} ${k.keyword}`)}
        ctaLabel={siteId ? "Run audit on top page" : "View audit page"}
        ctaAction={siteId ? runAuditAction : undefined}
        ctaHref={siteId ? undefined : `/dashboard/audits?url=${encodeURIComponent(topAuditUrl)}`}
        ctaSuccessLabel="Audit started — opening results…"
        metric={{ value: String(strong.length), caption: "top 10 keywords" }}
      />,
    );
  }

  if (improving.length > 0) {
    const avgPos = Math.round(
      improving.reduce((s, k) => s + k.avgPosition, 0) / improving.length,
    );
    const bestKw = improving.reduce((best, k) =>
      k.impressions > best.impressions ? k : best,
    );
    cards.push(
      <PlaybookCard
        key="improving"
        icon={TrendingUp}
        label="Push to page 1"
        labelColor="text-blue-400"
        title={`${improving.length} keyword${improving.length > 1 ? "s" : ""} at position ${avgPos} — one push away from page 1`}
        description="Keywords ranked 11–20 are the easiest wins in SEO. Add a direct-answer first paragraph, include FAQ schema targeting the query as a question, add 2–3 internal links from your page-1 content, and earn one new backlink to the specific URL. A 3-position improvement from #15 to #12 can double your impressions."
        keywords={improving.slice(0, 6).map((k) => `#${Math.round(k.avgPosition)} ${k.keyword}`)}
        ctaLabel="See keyword opportunities"
        ctaHref={`/dashboard/keywords?highlight=${encodeURIComponent(bestKw.keyword)}#opportunities`}
        metric={{ value: `#${avgPos}`, caption: "avg position" }}
      />,
    );
  }

  if (allWeak.length > 0) {
    const wordFreq = allWeak
      .flatMap((k) => k.keyword.toLowerCase().split(/\s+/))
      .reduce<Record<string, number>>((acc, w) => {
        if (w.length > 3) acc[w] = (acc[w] ?? 0) + 1;
        return acc;
      }, {});
    const topWord       = Object.entries(wordFreq).sort((a, b) => b[1] - a[1])[0];
    const dominantTopic = topWord && topWord[1] >= 5 ? topWord[0] : null;
    const totalImpr     = allWeak.reduce((s, k) => s + k.impressions, 0);
    const pillarKw      = dominantTopic ?? allWeak[0].keyword;
    const pillarRow     = allWeak[0];

    const generatePillarAction = async () =>
      generateBlogForKeyword(
        pillarKw,
        pillarRow.avgPosition,
        pillarRow.impressions,
        siteId,
        "pillar",
      );

    cards.push(
      <PlaybookCard
        key="weak"
        icon={Target}
        label="Consolidate & build"
        labelColor="text-rose-400"
        title={
          dominantTopic
            ? `${allWeak.length} "${dominantTopic}" variations splitting your ranking signals — consolidate into one pillar page`
            : `${allWeak.length} critical/weak keywords need content depth`
        }
        description={
          dominantTopic
            ? `You have ${allWeak.length} keyword variations around "${dominantTopic}" all landing on the same URL with low authority. Fix: expand that page into a 3,000+ word pillar covering all variations. Add a comparison table and FAQ schema. This consolidates all ranking signals into one strong page.`
            : `These keywords rank below page 2 and get ${totalImpr.toLocaleString()} impressions but nearly zero clicks. Each needs either a dedicated landing page or a major content expansion. Start with the keyword that has the most impressions and lowest keyword difficulty.`
        }
        keywords={allWeak.slice(0, 6).map((k) => `#${Math.round(k.avgPosition)} ${k.keyword}`)}
        ctaLabel={dominantTopic ? "Generate pillar content" : "Generate blog post"}
        ctaAction={generatePillarAction}
        ctaSuccessLabel="Pillar draft created — check Content tab"
        metric={{ value: totalImpr.toLocaleString(), caption: "impressions wasted" }}
      />,
    );
  }

  if (topOpp) {
    const generateOppAction = async () =>
      generateBlogForKeyword(
        topOpp.keyword,
        topOpp.avgPosition,
        topOpp.impressions,
        siteId,
        "informational",
      );

    cards.push(
      <PlaybookCard
        key="opportunity"
        icon={PenLine}
        label="Content opportunity"
        labelColor="text-purple-400"
        title={`Write a dedicated post for "${topOpp.keyword}" — ${topOpp.impressions} impressions at #${Math.round(topOpp.avgPosition)}`}
        description={`This keyword has the best combination of impression volume and reachable position. A dedicated 1,800–2,500 word article built around this exact query — with a comparison table, FAQ schema, and targeting the query's specific intent — could realistically move from #${Math.round(topOpp.avgPosition)} to page 1 within 60–90 days.`}
        keywords={opportunities.slice(0, 4).map((o) => o.keyword)}
        ctaLabel="Generate blog post now"
        ctaAction={generateOppAction}
        ctaSuccessLabel="Blog draft created — check Content tab"
        metric={{ value: String(topOpp.impressions), caption: "impressions/mo" }}
      />,
    );
  }

  return (
    <section aria-label="Keyword action playbook">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold">Your keyword playbook</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Data-driven next steps based on your {summary.total} tracked keywords
            {totalMissed > 0 && (
              <>
                {" — estimated "}
                <span className="text-amber-400 font-medium">
                  {totalMissed.toLocaleString()} missed clicks/month
                </span>
                {" recoverable"}
              </>
            )}
          </p>
        </div>
        <Link
          href="/dashboard/recommendations"
          className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-primary hover:opacity-80 transition-opacity"
        >
          Full recommendations
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{cards}</div>
    </section>
  );
}
