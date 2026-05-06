// src/app/dashboard/planner/PageScorePanel.tsx
"use client";

import { useTransition } from "react";
import { updatePageScore } from "@/app/actions/planner";
import { PageScoreChecks } from "@/types/planner";

interface Props {
  siteId: string;
  item: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  onUpdate: (updatedItem: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const CHECKLIST: Array<{ key: keyof PageScoreChecks; label: string; group: string }> = [
  // Technical
  { key: "pageSpeed", label: "Page loads under 3s (PageSpeed Insights)", group: "Technical" },
  { key: "mobileFriendly", label: "Mobile-friendly (Google test)", group: "Technical" },
  { key: "httpsEnabled", label: "HTTPS enabled", group: "Technical" },
  { key: "inSitemap", label: "Submitted in Search Console sitemap", group: "Technical" },
  { key: "nobrokenLinks", label: "No broken links on the page", group: "Technical" },
  // On-page
  { key: "titleHasKeyword", label: "Title tag contains target keyword", group: "On-page" },
  { key: "metaDescription", label: "Meta description 150–160 chars with keyword", group: "On-page" },
  { key: "h1HasKeyword", label: "H1 heading matches keyword", group: "On-page" },
  { key: "cleanSlug", label: "URL slug is short and keyword-focused", group: "On-page" },
  { key: "keywordInOpening", label: "Keyword in first 100 words", group: "On-page" },
  { key: "altTextOnImages", label: "Images have descriptive alt text", group: "On-page" },
  { key: "schemaMarkup", label: "Schema markup added (Article / FAQ)", group: "On-page" },
  // Content quality
  { key: "longerThanCompetitors", label: "Longer & more helpful than top 3 results", group: "Quality" },
  { key: "originalInsight", label: "Has original data, example, or perspective", group: "Quality" },
  { key: "updatedDateShown", label: "Updated date shown on page", group: "Quality" },
  { key: "authorBio", label: "Author bio / E-E-A-T signals present", group: "Quality" },
  { key: "outboundLinks", label: "Links to 2–3 credible external sources", group: "Quality" },
];

const GROUP_COLORS: Record<string, string> = {
  Technical: "text-blue-400",
  "On-page": "text-emerald-400",
  Quality: "text-purple-400",
};

export function PageScorePanel({ siteId, item, onUpdate }: Props) {
  const [isPending, startTransition] = useTransition();
  const pageScore = item.pageScore ?? { checks: {}, score: 0, lastUpdated: null };
  const checks: Partial<PageScoreChecks> = pageScore.checks ?? {};

  const toggle = (key: keyof PageScoreChecks) => {
    const newChecks = { ...checks, [key]: !checks[key] };
    const total = CHECKLIST.length;
    const passed = Object.values(newChecks).filter(Boolean).length;
    const score = Math.round((passed / total) * 100);

    startTransition(async () => {
      await updatePageScore(siteId, item.id, { [key]: !checks[key] });
      onUpdate({
        ...item,
        pageScore: { checks: newChecks, score, lastUpdated: new Date().toISOString() },
      });
    });
  };

  const score = pageScore.score ?? 0;
  const scoreColor = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const groups = [...new Set(CHECKLIST.map(c => c.group))];

  return (
    <div className="space-y-5">
      {/* Score display */}
      <div className="flex items-center gap-6 p-4 rounded-xl border border-border bg-muted/30">
        <div className="text-center">
          <p className={`text-5xl font-bold ${scoreColor}`}>{score}</p>
          <p className="text-xs text-muted-foreground mt-1">Page score</p>
        </div>
        <div className="flex-1">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${score}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {score < 30 && "Lots of quick wins available — start with on-page elements."}
            {score >= 30 && score < 60 && "Good progress. Focus on technical checks next."}
            {score >= 60 && score < 90 && "Strong page. A few finishing touches left."}
            {score >= 90 && "Fully optimised — publish with confidence."}
          </p>
          {pageScore.lastUpdated && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Last updated {new Date(pageScore.lastUpdated).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {/* Checklist by group */}
      {groups.map(group => (
        <div key={group}>
          <h4 className={`text-xs uppercase font-bold tracking-wider mb-2 ${GROUP_COLORS[group]}`}>{group}</h4>
          <div className="space-y-2">
            {CHECKLIST.filter(c => c.group === group).map(({ key, label }) => (
              <label
                key={key}
                className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/30 cursor-pointer group"
              >
                <input
                  type="checkbox"
                  checked={!!checks[key]}
                  onChange={() => toggle(key)}
                  disabled={isPending}
                  className="mt-0.5 w-4 h-4 rounded accent-emerald-500 shrink-0"
                />
                <span className={`text-sm leading-snug ${checks[key] ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
