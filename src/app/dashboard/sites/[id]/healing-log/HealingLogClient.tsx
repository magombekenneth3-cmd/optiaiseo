"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Filter,
  ChevronDown,
  ExternalLink,
  Zap,
  GitPullRequest,
  RefreshCcw,
  Shield,
  Activity,
} from "lucide-react";

interface HealingLogEntry {
  id: string;
  issueType: string;
  description: string;
  actionTaken: string;
  impactScore: number | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

type StatusFilter = "ALL" | "COMPLETED" | "PENDING" | "FAILED";

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  COMPLETED: { label: "Completed", icon: CheckCircle2, cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  PENDING: { label: "Pending", icon: Clock, cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  IN_PROGRESS: { label: "In Progress", icon: Activity, cls: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" },
  NO_IMPACT: { label: "No Impact", icon: AlertCircle, cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  FAILED: { label: "Failed", icon: XCircle, cls: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
  SKIPPED: { label: "Skipped", icon: AlertCircle, cls: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20" },
};

const ISSUE_ICONS: Record<string, typeof Zap> = {
  AUTOPILOT_TOGGLE: Shield,
  GSC_ANOMALY: TrendingDown,
  GSOV_DROP: TrendingDown,
  AUTO_FIX_PR: GitPullRequest,
  CONTENT_REFRESH: RefreshCcw,
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${cfg.cls}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function ImpactIndicator({ score }: { score: number | null }) {
  if (score === null) return <span className="text-[11px] text-muted-foreground">—</span>;
  const isPositive = score > 0;
  const isNeutral = score === 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums ${
      isPositive ? "text-emerald-400" : isNeutral ? "text-muted-foreground" : "text-rose-400"
    }`}>
      {isPositive ? <TrendingUp className="w-3 h-3" /> : !isNeutral ? <TrendingDown className="w-3 h-3" /> : null}
      {isPositive ? "+" : ""}{score}
    </span>
  );
}

function IssueTypeBadge({ type }: { type: string }) {
  const Icon = ISSUE_ICONS[type] ?? Zap;
  const label = type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HealingLogClient({
  logs,
  siteId,
  domain,
}: {
  logs: HealingLogEntry[];
  siteId: string;
  domain: string;
}) {
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "ALL") return logs;
    if (filter === "FAILED") return logs.filter((l) => l.status === "FAILED" || l.status === "SKIPPED");
    return logs.filter((l) => l.status === filter);
  }, [logs, filter]);

  const completed = logs.filter((l) => l.status === "COMPLETED").length;
  const pending = logs.filter((l) => l.status === "PENDING" || l.status === "IN_PROGRESS").length;
  const failed = logs.filter((l) => l.status === "FAILED" || l.status === "SKIPPED").length;
  const impactScores = logs.map((l) => l.impactScore).filter((s): s is number => s !== null);
  const totalImpact = impactScores.reduce((a, b) => a + b, 0);
  const avgImpact = impactScores.length ? (totalImpact / impactScores.length).toFixed(1) : "0";
  const highImpact = impactScores.filter((s) => s > 5).length;
  const successRate = logs.length ? Math.round((completed / logs.length) * 100) : 0;
  const timeSaved = (logs.length * 0.5).toFixed(1);

  const FILTERS: { key: StatusFilter; label: string; count: number }[] = [
    { key: "ALL", label: "All", count: logs.length },
    { key: "COMPLETED", label: "Completed", count: completed },
    { key: "PENDING", label: "Pending", count: pending },
    { key: "FAILED", label: "Failed", count: failed },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Fixes", value: String(logs.length), color: "text-foreground" },
          { label: "Completed", value: String(completed), color: "text-emerald-400" },
          { label: "Success Rate", value: `${successRate}%`, color: successRate >= 80 ? "text-emerald-400" : successRate >= 50 ? "text-amber-400" : "text-rose-400" },
          { label: "High Impact", value: String(highImpact), color: "text-blue-400" },
          { label: "Avg Impact", value: avgImpact, color: "text-foreground" },
          { label: "Time Saved", value: `${timeSaved}h`, color: "text-violet-400" },
        ].map((c) => (
          <div key={c.label} className="card-surface p-4">
            <p className="text-[11px] text-muted-foreground font-medium mb-1">{c.label}</p>
            <p className={`text-xl font-bold tabular-nums ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
              filter === f.key
                ? "bg-foreground text-background border-foreground"
                : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
            }`}
          >
            {f.label}
            <span className="ml-1 opacity-60">{f.count}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card-surface p-12 text-center border-dashed">
          <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium mb-1">
            {filter === "ALL" ? "No healing actions yet" : `No ${filter.toLowerCase()} actions`}
          </p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {filter === "ALL"
              ? "Enable Autopilot on this site — the engine will detect regressions and queue fixes here."
              : "Try changing the filter to see other entries."}
          </p>
          {filter === "ALL" && (
            <Link
              href={`/dashboard/sites/${siteId}`}
              className="inline-flex items-center gap-1.5 mt-4 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              Go to site settings →
            </Link>
          )}
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3 w-8" />
                  <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">Date</th>
                  <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">Type</th>
                  <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Description</th>
                  <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">Impact</th>
                  <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log, i) => {
                  const isExpanded = expandedId === log.id;
                  const prUrl = (log.metadata as Record<string, unknown>)?.prUrl as string | undefined;
                  return (
                    <>
                      <tr
                        key={log.id}
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        className={`border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/20 ${
                          i % 2 === 0 ? "" : "bg-muted/10"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-xs text-foreground font-medium">{formatDate(log.createdAt)}</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5">{formatTime(log.createdAt)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <IssueTypeBadge type={log.issueType} />
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell max-w-[220px]">
                          <span className="text-xs text-muted-foreground truncate block" title={log.description}>
                            {log.description}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <ImpactIndicator score={log.impactScore} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={log.status} />
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${log.id}-detail`} className="bg-card/80">
                          <td colSpan={6} className="px-6 py-4 border-b border-border">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                              <div>
                                <p className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px] mb-1">Description</p>
                                <p className="text-foreground leading-relaxed">{log.description}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px] mb-1">Action Taken</p>
                                <p className="text-foreground leading-relaxed">{log.actionTaken}</p>
                              </div>
                              {prUrl && (
                                <div className="sm:col-span-2">
                                  <a
                                    href={prUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                                  >
                                    <GitPullRequest className="w-3.5 h-3.5" />
                                    View Pull Request
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              )}
                              {log.impactScore !== null && (
                                <div>
                                  <p className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px] mb-1">Impact Score</p>
                                  <div className="flex items-center gap-2">
                                    <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          log.impactScore > 0 ? "bg-emerald-500" : log.impactScore < 0 ? "bg-rose-500" : "bg-muted-foreground"
                                        }`}
                                        style={{ width: `${Math.min(100, Math.abs(log.impactScore) * 5)}%` }}
                                      />
                                    </div>
                                    <ImpactIndicator score={log.impactScore} />
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-border bg-card/30 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              Showing {filtered.length} of {logs.length} entries
            </p>
            <p className="text-[11px] text-muted-foreground">
              ~{timeSaved} hours of manual work automated
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
