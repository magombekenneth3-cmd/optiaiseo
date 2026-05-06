"use client";
import { useEffect, useState } from "react";
import { Users, DollarSign, Activity, FileText, TrendingUp, UserCheck } from "lucide-react";
import { StatCard } from "@/components/admin/StatCard";
import { AdminChart } from "@/components/admin/AdminChart";

interface StatsData {
  totalUsers: number;
  newThisMonth: number;
  proCount: number;
  agencyCount: number;
  freeCount: number;
  mrr: number;
  activeSubscribers: number;
  totalBlogs: number;
  totalAudits: number;
  dailySignups: { day: string; count: number }[];
}

function SkeletonCard() {
  return <div className="admin-skeleton rounded-2xl h-[116px]" />;
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} — ${r.statusText}`);
        return r.json();
      })
      .then(setData)
      .catch((err: Error) => {
        console.error("[Admin/Overview] stats fetch failed:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  const sparklineData = (data?.dailySignups ?? []).map((d) => ({
    day: d.day.slice(5), // MM-DD
    count: d.count,
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="admin-page-title">Overview</h1>
        <p className="admin-page-subtitle">Platform-wide metrics at a glance</p>
      </div>

      {/* Error state — visible when API call fails */}
      {error && (
        <div className="admin-card p-4 border border-red-500/30 bg-red-500/10 flex items-start gap-3">
          <span className="text-red-400 text-lg shrink-0" aria-hidden="true">⚠</span>
          <div>
            <p className="text-red-400 text-sm font-semibold">Failed to load stats</p>
            <p className="text-red-400/70 text-xs mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatCard
              label="Total Users"
              value={data?.totalUsers ?? 0}
              icon={<Users className="w-5 h-5" />}
              accentClass="admin-accent-purple"
            />
            <StatCard
              label="MRR"
              value={`$${(data?.mrr ?? 0).toLocaleString()}`}
              icon={<DollarSign className="w-5 h-5" />}
              accentClass="admin-accent-green"
            />
            <StatCard
              label="Subscribers"
              value={data?.activeSubscribers ?? 0}
              icon={<UserCheck className="w-5 h-5" />}
              accentClass="admin-accent-blue"
            />
            <StatCard
              label="Free Users"
              value={data?.freeCount ?? 0}
              icon={<Users className="w-5 h-5" />}
              accentClass="admin-accent-orange"
            />
            <StatCard
              label="New This Month"
              value={data?.newThisMonth ?? 0}
              icon={<TrendingUp className="w-5 h-5" />}
              accentClass="admin-accent-pink"
            />
            <StatCard
              label="Total Blogs"
              value={data?.totalBlogs ?? 0}
              icon={<FileText className="w-5 h-5" />}
              accentClass="admin-accent-yellow"
            />
          </>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sparkline */}
        <div className="lg:col-span-2 admin-card p-6">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-1">
            Signups — Last 30 Days
          </h2>
          {loading ? (
            <div className="admin-skeleton h-48 mt-4 rounded-xl" />
          ) : (
            <AdminChart
              type="area"
              data={sparklineData}
              dataKeys={[{ key: "count", label: "Signups", color: "#a78bfa" }]}
              xKey="day"
              height={192}
            />
          )}
        </div>

        {/* Tier breakdown */}
        <div className="admin-card p-6 flex flex-col">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
            Tier Breakdown
          </h2>
          {loading ? (
            <div className="admin-skeleton flex-1 rounded-xl" />
          ) : (
            <>
              <AdminChart
                type="donut"
                data={[
                  { name: "Free", value: data?.freeCount ?? 0 },
                  { name: "Pro", value: data?.proCount ?? 0 },
                  { name: "Agency", value: data?.agencyCount ?? 0 },
                ]}
                dataKeys={[]}
                nameKey="name"
                valueKey="value"
                height={160}
              />
              <div className="mt-4 space-y-2">
                {[
                  { label: "Free", value: data?.freeCount ?? 0, color: "#a78bfa" },
                  { label: "Pro", value: data?.proCount ?? 0, color: "#60a5fa" },
                  { label: "Agency", value: data?.agencyCount ?? 0, color: "#34d399" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                      <span className="text-white/50">{item.label}</span>
                    </div>
                    <span className="font-semibold text-white">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="admin-card p-5 flex flex-col gap-1">
          <p className="text-xs text-white/40 uppercase tracking-widest font-semibold">Pro</p>
          <p className="text-2xl font-bold text-violet-400">{loading ? "—" : data?.proCount ?? 0}</p>
          <p className="text-xs text-white/30">subscribers</p>
        </div>
        <div className="admin-card p-5 flex flex-col gap-1">
          <p className="text-xs text-white/40 uppercase tracking-widest font-semibold">Agency</p>
          <p className="text-2xl font-bold text-emerald-400">{loading ? "—" : data?.agencyCount ?? 0}</p>
          <p className="text-xs text-white/30">subscribers</p>
        </div>
        <div className="admin-card p-5 flex flex-col gap-1">
          <p className="text-xs text-white/40 uppercase tracking-widest font-semibold">Audits</p>
          <p className="text-2xl font-bold text-blue-400">{loading ? "—" : data?.totalAudits ?? 0}</p>
          <p className="text-xs text-white/30">this month</p>
        </div>
        <div className="admin-card p-5 flex flex-col gap-1">
          <p className="text-xs text-white/40 uppercase tracking-widest font-semibold">Blogs</p>
          <p className="text-2xl font-bold text-pink-400">{loading ? "—" : data?.totalBlogs ?? 0}</p>
          <p className="text-xs text-white/30">all time</p>
        </div>
      </div>
    </div>
  );
}
