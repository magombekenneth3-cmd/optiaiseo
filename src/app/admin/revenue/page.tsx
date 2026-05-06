"use client";
import { useEffect, useState } from "react";
import { DollarSign, TrendingUp, Users, Crown } from "lucide-react";
import { StatCard } from "@/components/admin/StatCard";
import { AdminChart } from "@/components/admin/AdminChart";

interface RevenueData {
  mrr: number;
  proCount: number;
  agencyCount: number;
  monthlyTrend: { month: string; pro: number; agency: number; revenue: number }[];
  topUsers: { id: string; name: string | null; email: string | null; subscriptionTier: string; mrr: number }[];
}

export default function AdminRevenuePage() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/revenue")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const trendData = (data?.monthlyTrend ?? []).map((m) => ({
    month: m.month.slice(0, 7),
    Revenue: m.revenue,
    Pro: m.pro * 39,
    Agency: m.agency * 99,
  }));

  const donutData = [
    { name: "Pro ($39)", value: data?.proCount ?? 0 },
    { name: "Agency ($99)", value: data?.agencyCount ?? 0 },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">Revenue</h1>
        <p className="admin-page-subtitle">MRR from active subscriptions (DB-based)</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="admin-skeleton rounded-2xl h-[116px]" />
          ))
        ) : (
          <>
            <StatCard
              label="Monthly Recurring Revenue"
              value={`$${(data?.mrr ?? 0).toLocaleString()}`}
              icon={<DollarSign className="w-5 h-5" />}
              accentClass="admin-accent-green"
            />
            <StatCard
              label="Pro Subscribers"
              value={data?.proCount ?? 0}
              icon={<TrendingUp className="w-5 h-5" />}
              accentClass="admin-accent-purple"
            />
            <StatCard
              label="Agency Subscribers"
              value={data?.agencyCount ?? 0}
              icon={<Crown className="w-5 h-5" />}
              accentClass="admin-accent-blue"
            />
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 admin-card p-6">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
            Monthly Revenue Trend
          </h2>
          {loading ? (
            <div className="admin-skeleton h-48 rounded-xl" />
          ) : (
            <AdminChart
              type="bar"
              data={trendData}
              dataKeys={[
                { key: "Pro", label: "Pro", color: "#a78bfa" },
                { key: "Agency", label: "Agency", color: "#34d399" },
              ]}
              xKey="month"
              height={192}
              showLegend
            />
          )}
        </div>

        <div className="admin-card p-6">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
            Distribution
          </h2>
          {loading ? (
            <div className="admin-skeleton h-48 rounded-xl" />
          ) : (
            <>
              <AdminChart
                type="donut"
                data={donutData}
                dataKeys={[]}
                nameKey="name"
                valueKey="value"
                height={160}
              />
              <div className="mt-4 space-y-2">
                {[
                  { label: "Pro ($39/mo)", count: data?.proCount ?? 0, color: "#a78bfa", mrr: (data?.proCount ?? 0) * 39 },
                  { label: "Agency ($99/mo)", count: data?.agencyCount ?? 0, color: "#34d399", mrr: (data?.agencyCount ?? 0) * 99 },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                      <span className="text-white/50">{item.label}</span>
                    </div>
                    <span className="font-semibold text-white">${item.mrr.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Top revenue users table */}
      <div className="admin-card p-6">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
          Top Revenue Users
        </h2>
        {loading ? (
          <div className="admin-skeleton h-40 rounded-xl" />
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>User</th>
                  <th>Tier</th>
                  <th>MRR</th>
                </tr>
              </thead>
              <tbody>
                {data?.topUsers.map((u, i) => (
                  <tr key={u.id}>
                    <td className="text-white/30 font-mono text-xs">{i + 1}</td>
                    <td>
                      <div>
                        <p className="font-medium text-white">{u.name ?? "—"}</p>
                        <p className="text-xs text-white/40">{u.email}</p>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`admin-tier-badge ${
                          u.subscriptionTier === "AGENCY" ? "admin-tier-agency" : "admin-tier-pro"
                        }`}
                      >
                        {u.subscriptionTier}
                      </span>
                    </td>
                    <td className="font-semibold text-emerald-400">${u.mrr}/mo</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
