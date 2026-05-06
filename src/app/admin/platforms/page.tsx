"use client";
import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { AdminChart } from "@/components/admin/AdminChart";

interface PlatformsData {
  platformAverages: {
    perplexity: number;
    chatgpt: number;
    claude: number;
    googleAio: number;
    grok: number;
    copilot: number;
    overall: number;
  };
  topSites: { siteId: string; domain: string; score: number; grade: string }[];
  bottomSites: { siteId: string; domain: string; score: number; grade: string }[];
}

const PLATFORMS = [
  { key: "perplexity", label: "Perplexity", color: "#a78bfa" },
  { key: "chatgpt", label: "ChatGPT", color: "#34d399" },
  { key: "claude", label: "Claude", color: "#fb923c" },
  { key: "googleAio", label: "Google AIO", color: "#60a5fa" },
  { key: "grok", label: "Grok", color: "#f472b6" },
  { key: "copilot", label: "Copilot", color: "#facc15" },
];

function GradeBadge({ grade }: { grade: string }) {
  const first = grade.charAt(0).toUpperCase();
  const cls =
    first === "A"
      ? "admin-grade-a"
      : first === "B"
        ? "admin-grade-b"
        : first === "C"
          ? "admin-grade-c"
          : "admin-grade-d";
  return <span className={cls}>{grade}</span>;
}

export default function AdminPlatformsPage() {
  const [data, setData] = useState<PlatformsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/platforms")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const avg = data?.platformAverages;
  const radarData = PLATFORMS.map((p) => ({
    platform: p.label,
    score: avg?.[p.key as keyof typeof avg] ?? 0,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">AEO Platforms</h1>
        <p className="admin-page-subtitle">Average AI engine scores across all sites</p>
      </div>

      {/* Overall health */}
      <div className="admin-card p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl admin-accent-purple flex items-center justify-center">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Average Overall AEO Score</p>
            <p className="text-xs text-white/40">Across all sites with AEO snapshots</p>
          </div>
          <p className="ml-auto text-3xl font-bold text-violet-400">
            {loading ? "—" : avg?.overall ?? 0}
          </p>
        </div>

        {/* Per-platform score bars */}
        <div className="space-y-3">
          {PLATFORMS.map((platform) => {
            const score = avg?.[platform.key as keyof typeof avg] ?? 0;
            return (
              <div key={platform.key} className="flex items-center gap-4">
                <p className="text-xs font-medium text-white/60 w-24 shrink-0">{platform.label}</p>
                <div className="flex-1 admin-score-bar-bg">
                  <div
                    className="admin-score-bar-fill"
                    style={{
                      width: loading ? "0%" : `${score}%`,
                      background: platform.color,
                    }}
                  />
                </div>
                <p className="text-xs font-bold text-white w-8 text-right">
                  {loading ? "—" : score}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bar chart */}
      <div className="admin-card p-6">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
          Platform Comparison
        </h2>
        {loading ? (
          <div className="admin-skeleton h-48 rounded-xl" />
        ) : (
          <AdminChart
            type="bar"
            data={radarData}
            dataKeys={[{ key: "score", label: "Avg Score", color: "#a78bfa" }]}
            xKey="platform"
            height={200}
          />
        )}
      </div>

      {/* Top / Bottom tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="admin-card p-6">
          <h2 className="text-sm font-semibold text-emerald-400 uppercase tracking-widest mb-4">
            🏆 Top Performers
          </h2>
          {loading ? (
            <div className="admin-skeleton h-48 rounded-xl" />
          ) : (
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Domain</th>
                    <th>Score</th>
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.topSites.map((s, i) => (
                    <tr key={s.siteId}>
                      <td className="text-white/30 font-mono text-xs">{i + 1}</td>
                      <td className="font-medium text-white text-xs">{s.domain}</td>
                      <td className="font-bold text-emerald-400">{s.score}</td>
                      <td><GradeBadge grade={s.grade} /></td>
                    </tr>
                  ))}
                  {!data?.topSites.length && (
                    <tr><td colSpan={4} className="text-center text-white/30 py-8">No data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="admin-card p-6">
          <h2 className="text-sm font-semibold text-rose-400 uppercase tracking-widest mb-4">
            ⚠️ Bottom Performers
          </h2>
          {loading ? (
            <div className="admin-skeleton h-48 rounded-xl" />
          ) : (
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Domain</th>
                    <th>Score</th>
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.bottomSites.map((s, i) => (
                    <tr key={s.siteId}>
                      <td className="text-white/30 font-mono text-xs">{i + 1}</td>
                      <td className="font-medium text-white text-xs">{s.domain}</td>
                      <td className="font-bold text-rose-400">{s.score}</td>
                      <td><GradeBadge grade={s.grade} /></td>
                    </tr>
                  ))}
                  {!data?.bottomSites.length && (
                    <tr><td colSpan={4} className="text-center text-white/30 py-8">No data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
