"use client";
import { useEffect, useState } from "react";
import { TrendingUp, Users, Zap } from "lucide-react";
import { StatCard } from "@/components/admin/StatCard";
import { AdminChart } from "@/components/admin/AdminChart";

interface GrowthData {
  weeklySignups: { week: string; count: number }[];
  cumulativeTotal: number;
  funnel: { free: number; pro: number; agency: number };
}

export default function AdminGrowthPage() {
  const [data, setData] = useState<GrowthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/growth")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const weeklyData = (data?.weeklySignups ?? []).map((w) => ({
    week: w.week.slice(5), // MM-DD
    Signups: w.count,
  }));

  // Build cumulative data: sum up from first week
  let cumulative = Math.max(0, (data?.cumulativeTotal ?? 0) - (data?.weeklySignups ?? []).reduce((a, w) => a + w.count, 0));
  const cumulativeData = (data?.weeklySignups ?? []).map((w) => {
    cumulative += w.count;
    return { week: w.week.slice(5), Total: cumulative };
  });

  const { free = 0, pro = 0, agency = 0 } = data?.funnel ?? {};
  const funnelData = [
    { stage: "Free", count: free + pro + agency },
    { stage: "→ Pro", count: pro + agency },
    { stage: "→ Agency", count: agency },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">Growth</h1>
        <p className="admin-page-subtitle">User acquisition and tier conversion trends</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="admin-skeleton rounded-2xl h-[116px]" />
          ))
        ) : (
          <>
            <StatCard
              label="Total Users"
              value={data?.cumulativeTotal ?? 0}
              icon={<Users className="w-5 h-5" />}
              accentClass="admin-accent-purple"
            />
            <StatCard
              label="Paid Conversion"
              value={`${data?.cumulativeTotal ? (((pro + agency) / data.cumulativeTotal) * 100).toFixed(1) : 0}%`}
              icon={<Zap className="w-5 h-5" />}
              accentClass="admin-accent-green"
            />
            <StatCard
              label="Agency Conversion"
              value={`${(pro + agency) > 0 ? ((agency / (pro + agency)) * 100).toFixed(1) : 0}%`}
              icon={<TrendingUp className="w-5 h-5" />}
              accentClass="admin-accent-blue"
            />
          </>
        )}
      </div>

      {/* Weekly signups chart */}
      <div className="admin-card p-6">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
          Weekly New Signups (Last 12 Weeks)
        </h2>
        {loading ? (
          <div className="admin-skeleton h-52 rounded-xl" />
        ) : weeklyData.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-white/30 text-sm">
            No signup data available yet
          </div>
        ) : (
          <AdminChart
            type="bar"
            data={weeklyData}
            dataKeys={[{ key: "Signups", label: "New Users", color: "#a78bfa" }]}
            xKey="week"
            height={208}
          />
        )}
      </div>

      {/* Cumulative area chart */}
      <div className="admin-card p-6">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
          Cumulative User Growth
        </h2>
        {loading ? (
          <div className="admin-skeleton h-52 rounded-xl" />
        ) : cumulativeData.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-white/30 text-sm">
            No data available yet
          </div>
        ) : (
          <AdminChart
            type="area"
            data={cumulativeData}
            dataKeys={[{ key: "Total", label: "Total Users", color: "#60a5fa" }]}
            xKey="week"
            height={208}
          />
        )}
      </div>

      {/* Funnel */}
      <div className="admin-card p-6">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-6">
          Tier Conversion Funnel
        </h2>
        {loading ? (
          <div className="admin-skeleton h-40 rounded-xl" />
        ) : (
          <div className="space-y-4">
            {funnelData.map((stage, i) => {
              const pct = funnelData[0].count > 0 ? (stage.count / funnelData[0].count) * 100 : 0;
              const colors = ["#a78bfa", "#60a5fa", "#34d399"];
              return (
                <div key={stage.stage}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-white/70">{stage.stage}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{stage.count.toLocaleString()}</span>
                      <span className="text-xs text-white/30">({pct.toFixed(1)}%)</span>
                    </div>
                  </div>
                  <div className="admin-score-bar-bg">
                    <div
                      className="admin-score-bar-fill"
                      style={{
                        width: `${pct}%`,
                        background: colors[i],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
