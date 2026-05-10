import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ArrowLeft, Zap, CheckCircle2, Clock, AlertCircle, TrendingUp } from "lucide-react";

// ── Status helpers ──────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle2; colour: string }> = {
  COMPLETED:  { label: "Completed",   icon: CheckCircle2, colour: "text-emerald-400" },
  NO_IMPACT:  { label: "No impact",   icon: AlertCircle,  colour: "text-amber-400"   },
  PENDING:    { label: "Pending",     icon: Clock,        colour: "text-blue-400"    },
  IN_PROGRESS:{ label: "In progress", icon: Clock,        colour: "text-indigo-400"  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? STATUS_MAP.PENDING;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cfg.colour}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {cfg.label}
    </span>
  );
}

function ImpactBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.min(100, Math.max(0, (score + 20) * 2.5)); // map -20..+20 → 0..100
  const colour = score > 0 ? "bg-emerald-500" : score < 0 ? "bg-rose-500" : "bg-muted";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-medium ${score > 0 ? "text-emerald-400" : score < 0 ? "text-rose-400" : "text-muted-foreground"}`}>
        {score > 0 ? "+" : ""}{score}
      </span>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await prisma.site.findUnique({ where: { id }, select: { domain: true } });
  return { title: site ? `Healing Log — ${site.domain}` : "Healing Log" };
}

export default async function HealingLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/signin");

  const site = await prisma.site.findFirst({
    where: {
      id,
      userId: session.user.id,
    },
    select: { id: true, domain: true },
  });

  if (!site) notFound();

  const logs = await prisma.selfHealingLog.findMany({
    where: { siteId: site.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Summary stats
  const totalCompleted  = logs.filter(l => l.status === "COMPLETED").length;
  const totalImpact     = logs.reduce((sum, l) => sum + (l.impactScore ?? 0), 0);
  const highImpact      = logs.filter(l => (l.impactScore ?? 0) > 5).length;
  const avgImpact       = logs.length ? (totalImpact / logs.length).toFixed(1) : "0";

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

      {/* Back link */}
      <Link
        href={`/dashboard/sites/${site.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {site.domain}
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5 mb-1">
          <Zap className="w-6 h-6 text-emerald-400" />
          Self-Healing Log
        </h1>
        <p className="text-sm text-muted-foreground">
          A full audit trail of every automated fix applied to <span className="font-medium text-foreground">{site.domain}</span>.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total fixes",      value: logs.length,    sub: "all time"           },
          { label: "Completed",        value: totalCompleted, sub: "successfully applied"},
          { label: "High-impact fixes",value: highImpact,     sub: "score delta > 5"    },
          { label: "Avg impact",       value: avgImpact,      sub: "score points"       },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-2xl font-black text-foreground">{value}</p>
            <p className="text-xs font-medium mt-0.5">{label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      {logs.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/20 p-12 text-center">
          <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium mb-1">No healing actions yet</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Enable Autopilot mode on this site — the engine will automatically detect regressions and queue fixes here.
          </p>
          <Link
            href={`/dashboard/sites/${site.id}`}
            className="inline-flex items-center gap-1.5 mt-4 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            Go to site settings →
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Date</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Issue type</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 hidden sm:table-cell">Description</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 hidden md:table-cell">Action taken</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Impact</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr
                    key={log.id}
                    className={`border-b border-border last:border-0 transition-colors hover:bg-muted/20 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short", year: "numeric"
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                        {log.issueType}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell max-w-[200px] truncate text-xs text-muted-foreground" title={log.description}>
                      {log.description}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell max-w-[180px] truncate text-xs" title={log.actionTaken}>
                      {log.actionTaken}
                    </td>
                    <td className="px-4 py-3">
                      <ImpactBar score={log.impactScore} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={log.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
