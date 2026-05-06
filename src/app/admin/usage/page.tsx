"use client";
import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { StatCard } from "@/components/admin/StatCard";

interface UsageUser {
  id: string;
  name: string | null;
  email: string | null;
  tier: string;
  auditsThisMonth: number;
  blogsThisMonth: number;
  auditsTotal: number;
  blogsTotal: number;
  aeoChecksTotal: number;
}

interface HeatmapCell { dow: number; hour: number; count: number; }

interface UsageData {
  users: UsageUser[];
  heatmap: HeatmapCell[];
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) =>
  i === 0 ? "12am" : i < 12 ? `${i}am` : i === 12 ? "12pm" : `${i - 12}pm`
);

function getHeatmapColor(count: number, max: number): string {
  if (count === 0 || max === 0) return "rgba(255,255,255,0.04)";
  const intensity = count / max;
  const alpha = 0.15 + intensity * 0.75;
  return `rgba(124,58,237,${alpha.toFixed(2)})`;
}

export default function AdminUsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/usage")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const totalAuditsMonth = data?.users.reduce((a, u) => a + u.auditsThisMonth, 0) ?? 0;
  const totalBlogsMonth = data?.users.reduce((a, u) => a + u.blogsThisMonth, 0) ?? 0;

  const maxHeat = Math.max(...(data?.heatmap.map((h) => h.count) ?? [1]), 1);

  // Build heatmap grid: [dow][hour]
  const heatGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  data?.heatmap.forEach(({ dow, hour, count }) => {
    heatGrid[dow][hour] = count;
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">Usage</h1>
        <p className="admin-page-subtitle">Platform activity per user this month</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="admin-skeleton rounded-2xl h-[116px]" />
          ))
        ) : (
          <>
            <StatCard
              label="Audits This Month"
              value={totalAuditsMonth}
              icon={<Activity className="w-5 h-5" />}
              accentClass="admin-accent-blue"
            />
            <StatCard
              label="Blogs This Month"
              value={totalBlogsMonth}
              icon={<Activity className="w-5 h-5" />}
              accentClass="admin-accent-purple"
            />
          </>
        )}
      </div>

      {/* Heatmap */}
      <div className="admin-card p-6">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-5">
          Audit Activity Heatmap (Last 90 Days)
        </h2>
        {loading ? (
          <div className="admin-skeleton h-36 rounded-xl" />
        ) : (
          <div className="overflow-x-auto">
            <div className="flex gap-4 min-w-max">
              {/* DOW labels */}
              <div className="flex flex-col gap-1 pt-5">
                {DOW_LABELS.map((d) => (
                  <div key={d} className="h-4 text-[10px] text-white/30 leading-none flex items-center">
                    {d}
                  </div>
                ))}
              </div>
              {/* Cells */}
              <div>
                {/* Hour headers (every 3h) */}
                <div className="flex gap-0.5 mb-1">
                  {HOUR_LABELS.map((h, i) => (
                    <div key={i} className="w-4 text-[9px] text-white/20 leading-none">
                      {i % 3 === 0 ? h : ""}
                    </div>
                  ))}
                </div>
                {heatGrid.map((row, dow) => (
                  <div key={dow} className="flex gap-0.5 mb-0.5">
                    {row.map((count, hour) => (
                      <div
                        key={hour}
                        className="admin-heatmap-cell"
                        style={{ background: getHeatmapColor(count, maxHeat) }}
                        title={`${DOW_LABELS[dow]} ${HOUR_LABELS[hour]}: ${count} audits`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Top consumers table */}
      <div className="admin-card p-6">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
          Top Consumers (This Month)
        </h2>
        {loading ? (
          <div className="admin-skeleton h-64 rounded-xl" />
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>User</th>
                  <th>Tier</th>
                  <th>Audits (Month)</th>
                  <th>Blogs (Month)</th>
                  <th>Audits (Total)</th>
                  <th>AEO Checks</th>
                </tr>
              </thead>
              <tbody>
                {data?.users.slice(0, 20).map((u, i) => (
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
                          u.tier === "AGENCY"
                            ? "admin-tier-agency"
                            : u.tier === "PRO"
                              ? "admin-tier-pro"
                              : "admin-tier-free"
                        }`}
                      >
                        {u.tier}
                      </span>
                    </td>
                    <td className="font-semibold text-blue-400">{u.auditsThisMonth}</td>
                    <td className="font-semibold text-violet-400">{u.blogsThisMonth}</td>
                    <td className="text-white/50">{u.auditsTotal}</td>
                    <td className="text-white/50">{u.aeoChecksTotal}</td>
                  </tr>
                ))}
                {!data?.users.length && (
                  <tr>
                    <td colSpan={7} className="text-center text-white/30 py-8">No usage data</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
