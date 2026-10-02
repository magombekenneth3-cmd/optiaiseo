"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Microscope,
  Shield,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";

interface VerificationGate {
  passed: number;
  failed: number;
  pending: number;
  insufficient: number;
  total: number;
}

interface HealthData {
  severity: { critical: number; high: number; medium: number; low: number };
  lifecycle: Record<string, number>;
  resolution: { last7d: number; last30d: number; last90d: number; total: number };
  verification: { t0: VerificationGate; t7: VerificationGate; t28: VerificationGate };
  totalFindings: number;
  siteId: string | null;
  domain: string | null;
}

const SEVERITY_COLORS: Record<string, { bar: string; text: string; label: string }> = {
  critical: { bar: "bg-rose-500", text: "text-rose-400", label: "Critical" },
  high: { bar: "bg-amber-500", text: "text-amber-400", label: "High" },
  medium: { bar: "bg-sky-500", text: "text-sky-400", label: "Medium" },
  low: { bar: "bg-zinc-500", text: "text-zinc-400", label: "Low" },
};

const LIFECYCLE_LABELS: Record<string, { label: string; text: string }> = {
  OPEN: { label: "Open", text: "text-rose-400" },
  IN_PROGRESS: { label: "In Progress", text: "text-amber-400" },
  RESOLVED: { label: "Resolved", text: "text-emerald-400" },
  REGRESSED: { label: "Regressed", text: "text-rose-400" },
  UNKNOWN: { label: "Unknown", text: "text-zinc-400" },
};

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 animate-pulse">
      <div className="h-3 w-24 rounded bg-muted/40 mb-3" />
      <div className="h-6 w-16 rounded bg-muted/30 mb-2" />
      <div className="h-2 w-full rounded bg-muted/20" />
    </div>
  );
}

function SeverityBar({ severity, count, maxCount }: { severity: string; count: number; maxCount: number }) {
  const cfg = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.medium;
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className={`text-[11px] font-semibold w-14 shrink-0 ${cfg.text}`}>
        {cfg.label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${cfg.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums text-foreground w-8 text-right">
        {count}
      </span>
    </div>
  );
}

function VerificationGateCard({ label, gate, icon: Icon }: { label: string; gate: VerificationGate; icon: typeof Shield }) {
  const total = gate.total;
  const passRate = total > 0 ? Math.round((gate.passed / total) * 100) : null;

  return (
    <div className="rounded-xl border border-border bg-card/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>

      {total === 0 ? (
        <p className="text-xs text-muted-foreground">No verification data recorded</p>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5 mb-2">
            {passRate !== null && (
              <span className="text-lg font-bold tabular-nums text-foreground">
                {passRate}%
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              pass rate · {total} checked
            </span>
          </div>
          <div className="flex gap-1 h-1.5 rounded-full overflow-hidden bg-muted/20">
            {gate.passed > 0 && (
              <div
                className="bg-emerald-500 rounded-full"
                style={{ width: `${(gate.passed / total) * 100}%` }}
                title={`${gate.passed} passed`}
              />
            )}
            {gate.failed > 0 && (
              <div
                className="bg-rose-500 rounded-full"
                style={{ width: `${(gate.failed / total) * 100}%` }}
                title={`${gate.failed} failed`}
              />
            )}
            {gate.insufficient > 0 && (
              <div
                className="bg-amber-500 rounded-full"
                style={{ width: `${(gate.insufficient / total) * 100}%` }}
                title={`${gate.insufficient} insufficient data`}
              />
            )}
            {gate.pending > 0 && (
              <div
                className="bg-zinc-500 rounded-full"
                style={{ width: `${(gate.pending / total) * 100}%` }}
                title={`${gate.pending} pending`}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2">
            {gate.passed > 0 && (
              <span className="text-[10px] text-emerald-400 font-medium">{gate.passed} passed</span>
            )}
            {gate.failed > 0 && (
              <span className="text-[10px] text-rose-400 font-medium">{gate.failed} failed</span>
            )}
            {gate.insufficient > 0 && (
              <span className="text-[10px] text-amber-400 font-medium">{gate.insufficient} insufficient</span>
            )}
            {gate.pending > 0 && (
              <span className="text-[10px] text-zinc-400 font-medium">{gate.pending} pending</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function DiagnosticHealthSummary({ siteId }: { siteId: string | null }) {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (siteId) params.set("siteId", siteId);
      const res = await fetch(`/api/diagnostics/health?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  if (loading) {
    return (
      <section
        aria-labelledby="diagnostic-health-summary"
        id="diagnostic-health-summary"
        className="overflow-hidden rounded-2xl border border-border bg-card"
      >
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            Diagnostic Health
          </p>
          <h2 id="diagnostic-health-summary" className="mt-1 text-sm font-semibold text-foreground">
            Loading diagnostic health…
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 sm:p-5">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        aria-labelledby="diagnostic-health-summary"
        id="diagnostic-health-summary"
        className="overflow-hidden rounded-2xl border border-border bg-card"
      >
        <div className="px-4 py-5 sm:px-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                Diagnostic health unavailable
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{error}</p>
              <button
                onClick={fetchHealth}
                className="mt-2 text-xs font-semibold text-brand hover:text-brand/80 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!data || data.totalFindings === 0) {
    return (
      <section
        aria-labelledby="diagnostic-health-summary"
        id="diagnostic-health-summary"
        className="overflow-hidden rounded-2xl border border-border bg-card"
      >
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            Diagnostic Health
          </p>
          <h2 id="diagnostic-health-summary" className="mt-1 text-sm font-semibold text-foreground">
            No diagnostic findings recorded
          </h2>
        </div>
        <div className="flex items-start gap-3 px-4 py-5 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">
              No diagnostic findings on record
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Run an audit to generate diagnostic findings. Health metrics will
              appear once findings are recorded.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const sevTotal = data.severity.critical + data.severity.high + data.severity.medium + data.severity.low;
  const maxSev = Math.max(data.severity.critical, data.severity.high, data.severity.medium, data.severity.low, 1);
  const resolvedCount = data.lifecycle.RESOLVED ?? 0;
  const regressedCount = data.lifecycle.REGRESSED ?? 0;
  const openCount = data.lifecycle.OPEN ?? 0;
  const inProgressCount = data.lifecycle.IN_PROGRESS ?? 0;

  return (
    <section
      aria-labelledby="diagnostic-health-summary"
      id="diagnostic-health-summary"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="flex flex-col gap-2 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            Diagnostic Health
          </p>
          <h2 id="diagnostic-health-summary" className="mt-1 text-sm font-semibold text-foreground">
            {data.totalFindings} finding{data.totalFindings === 1 ? "" : "s"} tracked
            {data.domain && <span className="text-muted-foreground font-normal"> · {data.domain}</span>}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Evidence-driven diagnostic metrics. No composite score — underlying signals shown transparently.
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

      <div className="p-4 sm:p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Active Issues
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">{sevTotal}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {sevTotal === 0 ? "No active diagnostic issues" : `${data.severity.critical} critical · ${data.severity.high} high`}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Resolved
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">{resolvedCount}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {data.resolution.last7d > 0 ? `${data.resolution.last7d} in last 7 days` : "No recent resolutions"}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Regressed
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">{regressedCount}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {regressedCount === 0 ? "No regressions detected" : "Previously resolved findings that recurred"}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                In Progress
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">{inProgressCount}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {inProgressCount === 0 ? "No findings in remediation" : "Findings with active remediation"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Microscope className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span className="text-xs font-semibold text-foreground">
                Active Finding Severity
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {sevTotal} active
              </span>
            </div>
            {sevTotal === 0 ? (
              <p className="text-xs text-muted-foreground">No active findings with FAIL or WARNING status.</p>
            ) : (
              <div className="space-y-2">
                {(["critical", "high", "medium", "low"] as const).map((s) => (
                  <SeverityBar key={s} severity={s} count={data.severity[s]} maxCount={maxSev} />
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span className="text-xs font-semibold text-foreground">
                Lifecycle Distribution
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {data.totalFindings} total
              </span>
            </div>
            <div className="space-y-1.5">
              {Object.entries(LIFECYCLE_LABELS).map(([key, cfg]) => {
                const count = data.lifecycle[key] ?? 0;
                return (
                  <div key={key} className="flex items-center justify-between">
                    <span className={`text-[11px] font-semibold ${cfg.text}`}>
                      {cfg.label}
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-foreground">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span className="text-xs font-semibold text-foreground">
                Resolution Velocity
              </span>
            </div>
            {data.resolution.total === 0 ? (
              <p className="text-xs text-muted-foreground">No findings resolved yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-lg font-bold tabular-nums text-foreground">{data.resolution.last7d}</p>
                  <p className="text-[10px] text-muted-foreground">Last 7 days</p>
                </div>
                <div>
                  <p className="text-lg font-bold tabular-nums text-foreground">{data.resolution.last30d}</p>
                  <p className="text-[10px] text-muted-foreground">Last 30 days</p>
                </div>
                <div>
                  <p className="text-lg font-bold tabular-nums text-foreground">{data.resolution.last90d}</p>
                  <p className="text-[10px] text-muted-foreground">Last 90 days</p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span className="text-xs font-semibold text-foreground">
                Verification Outcomes
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <VerificationGateCard label="T+0" gate={data.verification.t0} icon={Shield} />
              <VerificationGateCard label="T+7" gate={data.verification.t7} icon={Shield} />
              <VerificationGateCard label="T+28" gate={data.verification.t28} icon={Shield} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
