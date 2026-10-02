"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Microscope,
  Target,
  Wrench,
  XCircle,
} from "lucide-react";

interface PriorityFinding {
  id: string;
  fingerprint: string;
  issueType: string;
  status: string;
  severity: string;
  rootCause: string;
  confidence: number;
  expectedOutcome: string;
  remediationType: string;
  priorityScore: number | null;
  lifecycleState: string;
  createdAt: string;
}

const SEVERITY_STYLES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  critical: {
    bg: "border-rose-500/20 bg-rose-500/[0.06]",
    text: "text-rose-300",
    label: "Critical",
  },
  high: {
    bg: "border-amber-500/20 bg-amber-500/[0.06]",
    text: "text-amber-300",
    label: "High",
  },
  medium: {
    bg: "border-sky-500/20 bg-sky-500/[0.06]",
    text: "text-sky-300",
    label: "Medium",
  },
  low: {
    bg: "border-zinc-500/20 bg-zinc-500/[0.06]",
    text: "text-zinc-400",
    label: "Low",
  },
};

const LIFECYCLE_STYLES: Record<string, { text: string; label: string }> = {
  OPEN: { text: "text-rose-400", label: "Open" },
  IN_PROGRESS: { text: "text-amber-400", label: "In Progress" },
  RESOLVED: { text: "text-emerald-400", label: "Resolved" },
  REGRESSED: { text: "text-rose-400", label: "Regressed" },
  UNKNOWN: { text: "text-zinc-400", label: "Unknown" },
};

const STATUS_ICONS: Record<string, typeof XCircle> = {
  FAIL: XCircle,
  WARNING: AlertTriangle,
  PASS: CheckCircle2,
};

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function truncate(str: string, len: number): string {
  return str.length <= len ? str : str.slice(0, len) + "…";
}

function SkeletonRow() {
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 animate-pulse">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/40" />
        <div className="min-w-0 flex-1">
          <div className="h-4 w-48 rounded bg-muted/40" />
          <div className="mt-2 h-3 w-72 rounded bg-muted/30" />
          <div className="mt-2 h-3 w-32 rounded bg-muted/20" />
        </div>
      </div>
      <div className="h-9 w-24 shrink-0 rounded-lg bg-muted/30" />
    </li>
  );
}

export function DiagnosticPriorityQueue({ siteId }: { siteId: string | null }) {
  const [findings, setFindings] = useState<PriorityFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPriority = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (siteId) params.set("siteId", siteId);
      params.set("limit", "5");
      const res = await fetch(`/api/diagnostics/priority?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setFindings(data.findings ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchPriority();
  }, [fetchPriority]);

  return (
    <section
      aria-labelledby="diagnostic-priority-queue"
      id="diagnostic-priority-queue"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="flex flex-col gap-2 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            Diagnostic Findings
          </p>
          <h2
            id="diagnostic-priority-queue"
            className="mt-1 text-sm font-semibold text-foreground"
          >
            {loading
              ? "Loading findings…"
              : error
                ? "Unable to load findings"
                : findings.length > 0
                  ? `${findings.length} finding${findings.length === 1 ? "" : "s"} need attention`
                  : "No actionable findings"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {loading
              ? "Fetching priority findings from the diagnostic engine."
              : error
                ? "Diagnostic data is temporarily unavailable."
                : findings.length > 0
                  ? "Evidence-driven findings ordered by priority score."
                  : "All findings are either resolved or currently being addressed."}
          </p>
        </div>
        <Link
          href="/dashboard/diagnostics"
          className="inline-flex shrink-0 items-center gap-1 self-start text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground sm:self-center"
        >
          All diagnostics
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {loading ? (
        <ul className="divide-y divide-border">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </ul>
      ) : error ? (
        <div className="flex items-start gap-3 px-4 py-5 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              Could not load diagnostic findings
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {error}
            </p>
            <button
              onClick={fetchPriority}
              className="mt-2 text-xs font-semibold text-brand hover:text-brand/80 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      ) : findings.length === 0 ? (
        <div className="flex items-start gap-3 px-4 py-5 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">
              No actionable diagnostic findings
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              All diagnostic issues are resolved, verifying, or not yet
              detected. Run an audit to discover new findings.
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {findings.map((finding) => {
            const sevStyle =
              SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.medium;
            const lcStyle =
              LIFECYCLE_STYLES[finding.lifecycleState] ?? LIFECYCLE_STYLES.OPEN;
            const StatusIcon = STATUS_ICONS[finding.status] ?? AlertTriangle;
            const ctaLabel =
              finding.remediationType === "DETERMINISTIC"
                ? "Auto-fix"
                : finding.remediationType === "AI_PATCH"
                  ? "Generate fix"
                  : "View Details";

            return (
              <li
                key={finding.id}
                id={`priority-finding-${finding.id}`}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                    <StatusIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words text-sm font-semibold text-foreground">
                        {finding.issueType
                          .replace(/_/g, " ")
                          .replace(/([A-Z])/g, " $1")
                          .trim()}
                      </p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sevStyle.bg} ${sevStyle.text}`}
                      >
                        {sevStyle.label}
                      </span>
                      <span
                        className={`rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[11px] font-semibold ${lcStyle.text}`}
                      >
                        {lcStyle.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {truncate(finding.rootCause, 100)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      {finding.priorityScore !== null && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                          <Target
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                          Priority: {finding.priorityScore}/100
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {formatTimeAgo(finding.createdAt)}
                      </span>
                      {finding.remediationType !== "MANUAL" && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400/80">
                          <Wrench className="h-3 w-3" aria-hidden="true" />
                          {finding.remediationType === "DETERMINISTIC"
                            ? "Auto-fixable"
                            : "AI-fixable"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Link
                  href={`/dashboard/diagnostics?findingId=${encodeURIComponent(finding.id)}`}
                  className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-brand/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {ctaLabel}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
