"use client";

import { useState, useTransition } from "react";
import { getUserAudits } from "@/app/actions/audit";
import { extractAuditMetrics } from "@/lib/audit/helpers";
import Link from "next/link";
import { Loader2, ArrowRight } from "lucide-react";
import { DeleteAuditButton } from "./DeleteAuditButton";

// ── Types ─────────────────────────────────────────────────────────────────────

type AuditRow = {
  id: string;
  runTimestamp: Date;
  fixStatus: string;
  categoryScores: unknown;
  issueList: unknown;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  site: { id: string; domain: string };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 80) return "text-emerald-400";
  if (s >= 60) return "text-amber-400";
  return "text-rose-400";
}

function scoreBg(s: number) {
  if (s >= 80) return "bg-emerald-500/10 border-emerald-500/20";
  if (s >= 60) return "bg-amber-500/10 border-amber-500/20";
  return "bg-rose-500/10 border-rose-500/20";
}

function scoreLabel(s: number) {
  if (s >= 80) return "Good";
  if (s >= 60) return "Fair";
  return "Poor";
}

// Thin progress arc for score visual
function ScoreArc({ score }: { score: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#fbbf24" : "#f87171";
  return (
    <svg width={44} height={44} viewBox="0 0 44 44" className="rotate-[-90deg]">
      <circle cx={22} cy={22} r={r} fill="none" stroke="currentColor" strokeWidth={3}
        className="text-zinc-800" />
      <circle cx={22} cy={22} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(.4,0,.2,1)" }} />
    </svg>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; dot: string; label: string; pulse?: boolean }> = {
    COMPLETED: {
      cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      dot: "bg-emerald-400",
      label: "Completed",
    },
    IN_PROGRESS: {
      cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      dot: "bg-amber-400",
      label: "In progress",
      pulse: true,
    },
    PENDING: {
      cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      dot: "bg-blue-400",
      label: "Pending",
      pulse: true,
    },
    FAILED: {
      cls: "bg-rose-500/10 text-rose-400 border-rose-500/20",
      dot: "bg-rose-400",
      label: "Failed",
    },
  };
  const meta = map[status] ?? {
    cls: "bg-zinc-500/10 text-muted-foreground border-zinc-500/20",
    dot: "bg-zinc-400",
    label: status,
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${meta.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${meta.pulse ? "animate-pulse" : ""}`} />
      {meta.label}
    </span>
  );
}

// ── DeltaBadge ────────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const positive = delta > 0;
  return (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${positive
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
        : "bg-rose-500/10 text-rose-400 border-rose-500/20"
        }`}
    >
      {positive ? "↑ +" : "↓ "}{delta}
    </span>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="card-surface overflow-hidden">
      <div className="px-6 py-20 text-center flex flex-col items-center gap-4">
        {/* Icon */}
        <div className="w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center">
          <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div>
          <p className="font-semibold text-foreground">No audit reports yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            Click <strong className="text-foreground">Run manual audit</strong> above to perform your first technical SEO scan.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── AuditTable ────────────────────────────────────────────────────────────────

export function AuditTable({
  initialAudits,
  initialCursor,
}: {
  initialAudits: AuditRow[];
  initialCursor: string | null;
}) {
  const [audits, setAudits] = useState<AuditRow[]>(initialAudits);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [isPending, startTransition] = useTransition();

  const loadMore = () => {
    if (!cursor) return;
    startTransition(async () => {
      const result = await getUserAudits(cursor, 20);
      if (result.success && result.audits.length > 0) {
        setAudits((prev) => [...prev, ...(result.audits as AuditRow[])]);
        setCursor(result.nextCursor);
      }
    });
  };

  if (audits.length === 0) return <EmptyState />;

  return (
    <div className="flex flex-col gap-4">
      <div className="card-surface overflow-hidden">

        {/* ── Mobile card list ── */}
        <div className="md:hidden divide-y divide-border">
          {audits.map((audit) => {
            const { seoScore, issueCount } = extractAuditMetrics({
              categoryScores: audit.categoryScores as Record<string, unknown> | null,
              issueList: audit.issueList,
            });
            const isProcessing =
              audit.fixStatus === "IN_PROGRESS" ||
              audit.fixStatus === "PENDING" ||
              (audit.fixStatus === "COMPLETED" && issueCount === 0);

            return (
              <div key={audit.id} className="flex items-center gap-3 px-4 py-3.5 min-w-0">
                {/* Score arc */}
                <div className="shrink-0 relative w-11 h-11 flex items-center justify-center">
                  {isProcessing ? (
                    <div className="w-8 h-8 rounded-full border-2 border-brand/40 border-t-brand animate-spin" />
                  ) : (
                    <>
                      <ScoreArc score={seoScore} />
                      <span className={`absolute text-[10px] font-bold tabular-nums ${scoreColor(seoScore)}`}>
                        {seoScore || "—"}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{audit.site?.domain ?? "Unknown"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isProcessing
                      ? "Scanning…"
                      : `${issueCount} issue${issueCount !== 1 ? "s" : ""} · ${new Date(audit.runTimestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                  </p>
                </div>

                {!isProcessing && (
                  <Link
                    href={`/dashboard/audits/${audit.id}`}
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-muted border border-border hover:border-emerald-500/30 transition-colors"
                  >
                    View
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Desktop table ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap min-w-[680px]">
            <thead className="bg-card/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
              <tr>
                <th className="px-6 py-3.5">Domain</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5">SEO score</th>
                <th className="px-6 py-3.5">Issues</th>
                <th className="px-6 py-3.5">Date run</th>
                <th className="px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {audits.map((audit, idx) => {
                const { seoScore, issueCount } = extractAuditMetrics({
                  categoryScores: audit.categoryScores as Record<string, unknown> | null,
                  issueList: audit.issueList,
                });
                const isProcessing =
                  audit.fixStatus === "IN_PROGRESS" ||
                  audit.fixStatus === "PENDING" ||
                  (audit.fixStatus === "COMPLETED" && issueCount === 0);

                // Delta vs previous audit for same site
                const prevAudit = audits.slice(idx + 1).find((a) => a.site?.id === audit.site?.id);
                let delta: number | null = null;
                if (!isProcessing && prevAudit && prevAudit.fixStatus === "COMPLETED") {
                  const prev = extractAuditMetrics({
                    categoryScores: prevAudit.categoryScores as Record<string, unknown> | null,
                    issueList: prevAudit.issueList,
                  });
                  delta = seoScore - prev.seoScore;
                }

                return (
                  <tr key={audit.id} className="hover:bg-card/60 transition-colors group">
                    {/* Domain */}
                    <td className="px-6 py-4">
                      <span className="font-semibold text-foreground">{audit.site.domain}</span>
                    </td>

                    {/* Status */}
                    <td className="px-6 py-4">
                      <StatusBadge status={audit.fixStatus} />
                    </td>

                    {/* Score */}
                    <td className="px-6 py-4">
                      {isProcessing ? (
                        <span className="text-muted-foreground text-xs italic">Scanning…</span>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          <div className="relative w-9 h-9 flex items-center justify-center shrink-0">
                            <ScoreArc score={seoScore} />
                            <span className={`absolute text-[9px] font-bold tabular-nums ${scoreColor(seoScore)}`}>
                              {seoScore}
                            </span>
                          </div>
                          <div>
                            <div className={`text-sm font-bold tabular-nums ${scoreColor(seoScore)}`}>
                              {seoScore}/100
                            </div>
                            <div className={`text-[10px] ${scoreColor(seoScore)} opacity-70`}>
                              {scoreLabel(seoScore)}
                            </div>
                          </div>
                          {delta !== null && delta !== 0 && (
                            <DeltaBadge delta={delta} />
                          )}
                        </div>
                      )}
                    </td>

                    {/* Issues */}
                    <td className="px-6 py-4">
                      {isProcessing ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <span className={`font-semibold text-sm ${issueCount === 0 ? "text-emerald-400" : seoScore >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                          {issueCount}
                          <span className="text-muted-foreground font-normal text-xs ml-1">
                            {issueCount === 1 ? "issue" : "issues"}
                          </span>
                        </span>
                      )}
                    </td>

                    {/* Date */}
                    <td className="px-6 py-4 text-muted-foreground text-xs tabular-nums">
                      {new Date(audit.runTimestamp).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-4 text-right">
                      {isProcessing ? (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs italic">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Analyzing…
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2 justify-end">
                          <Link
                            href={`/dashboard/audits/${audit.id}`}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-muted border border-border hover:border-emerald-500/30 hover:text-emerald-400 transition-colors"
                          >
                            View report
                            <ArrowRight className="w-3 h-3 opacity-60" />
                          </Link>
                          <DeleteAuditButton auditId={audit.id} />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Load more */}
      {cursor && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-card hover:border-emerald-500/20 text-sm font-medium text-muted-foreground hover:text-foreground transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading…
              </>
            ) : (
              "Load more audits"
            )}
          </button>
        </div>
      )}
    </div>
  );
}