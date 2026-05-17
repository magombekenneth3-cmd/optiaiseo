import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireTiers } from "@/lib/stripe/guards";
import { ArrowRight, Globe, TrendingUp, ShieldAlert, Link2 } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agency Dashboard | OptiAISEO",
  description: "Portfolio overview for all managed client sites.",
};

function deriveScore(categoryScores: unknown): number | null {
  if (!categoryScores || typeof categoryScores !== "object") return null;
  const vals = Object.values(categoryScores as Record<string, unknown>).map((v) =>
    typeof v === "number" ? v : 0,
  );
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function scoreClass(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  if (v >= 75) return "text-emerald-500";
  if (v >= 50) return "text-amber-500";
  return "text-red-500";
}

export default async function AgencyDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, subscriptionTier: true },
  });
  if (!user) redirect("/login");

  try {
    await requireTiers(user.id, ["AGENCY"]);
  } catch {
    redirect("/dashboard");
  }

  const sites = await prisma.site.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      domain: true,
      shareToken: true,
      createdAt: true,
      audits: {
        orderBy: { runTimestamp: "desc" },
        take: 1,
        select: { categoryScores: true, runTimestamp: true, fixStatus: true },
      },
      aeoReports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { score: true, grade: true, generativeShareOfVoice: true },
      },
      _count: {
        select: {
          backlinkAlerts: {
            where: {
              detectedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            },
          },
        },
      },
    },
  });

  const portfolioStats = {
    total: sites.length,
    healthy: sites.filter((s) => {
      const score = deriveScore(s.audits[0]?.categoryScores);
      return score !== null && score >= 75;
    }).length,
    needsAttention: sites.filter((s) => {
      const score = deriveScore(s.audits[0]?.categoryScores);
      return score !== null && score < 50;
    }).length,
    avgAeo: sites.length
      ? Math.round(
          sites.reduce((sum, s) => sum + (s.aeoReports[0]?.score ?? 0), 0) / sites.length,
        )
      : 0,
  };

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto fade-in-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Agency Portfolio</h1>
        <p className="text-muted-foreground text-sm">
          {sites.length} managed {sites.length === 1 ? "site" : "sites"}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total sites", value: portfolioStats.total, icon: Globe, color: "text-blue-400" },
          { label: "Healthy (≥75)", value: portfolioStats.healthy, icon: TrendingUp, color: "text-emerald-500" },
          { label: "Needs attention", value: portfolioStats.needsAttention, icon: ShieldAlert, color: "text-red-500" },
          { label: "Avg AEO score", value: portfolioStats.avgAeo, icon: Link2, color: "text-violet-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card-surface rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs text-muted-foreground font-medium">{label}</span>
            </div>
            <div className={`text-2xl font-black ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="card-surface rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-4 font-semibold text-muted-foreground">Domain</th>
                <th className="text-left px-5 py-4 font-semibold text-muted-foreground">SEO score</th>
                <th className="text-left px-5 py-4 font-semibold text-muted-foreground">AEO score</th>
                <th className="text-left px-5 py-4 font-semibold text-muted-foreground">GSoV</th>
                <th className="text-left px-5 py-4 font-semibold text-muted-foreground">BL alerts (7d)</th>
                <th className="text-left px-5 py-4 font-semibold text-muted-foreground">Last audit</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => {
                const seoScore = deriveScore(site.audits[0]?.categoryScores);
                const aeoScore = site.aeoReports[0]?.score ?? null;
                const gsov = site.aeoReports[0]?.generativeShareOfVoice ?? null;
                const blAlerts = site._count.backlinkAlerts;
                const lastAudit = site.audits[0]?.runTimestamp;

                return (
                  <tr key={site.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-4 font-medium">{site.domain}</td>
                    <td className={`px-5 py-4 font-bold tabular-nums ${scoreClass(seoScore)}`}>
                      {seoScore !== null ? `${seoScore}/100` : "—"}
                    </td>
                    <td className={`px-5 py-4 font-bold tabular-nums ${scoreClass(aeoScore)}`}>
                      {aeoScore !== null ? `${aeoScore}/100` : "—"}
                    </td>
                    <td className="px-5 py-4 text-blue-400 font-semibold tabular-nums">
                      {gsov !== null ? `${gsov}%` : "—"}
                    </td>
                    <td className="px-5 py-4">
                      {blAlerts > 0 ? (
                        <span className="text-amber-400 font-semibold">{blAlerts}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground text-xs">
                      {lastAudit
                        ? lastAudit.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : "Never"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 justify-end">
                        {site.shareToken && (
                          <Link
                            href={`/client/${site.shareToken}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
                          >
                            Client view
                          </Link>
                        )}
                        <Link
                          href={`/dashboard/sites/${site.id}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#10b981] hover:opacity-80 transition-opacity"
                        >
                          Manage <ArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {sites.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-muted-foreground text-sm">
                    No sites yet.{" "}
                    <Link href="/dashboard/sites/new" className="text-[#10b981] hover:underline">
                      Add your first client site
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
