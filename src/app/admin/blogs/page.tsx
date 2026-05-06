"use client";
import { useEffect, useState } from "react";
import { FileText, PenLine, BookOpen } from "lucide-react";
import { StatCard } from "@/components/admin/StatCard";
import { AdminChart } from "@/components/admin/AdminChart";

interface BlogsData {
  totalBlogs: number;
  statusBreakdown: { status: string; count: number }[];
  topProducers: {
    siteId: string;
    domain: string;
    userId: string;
    userName: string | null;
    userEmail: string | null;
    totalBlogs: number;
    published: number;
    draft: number;
  }[];
}

export default function AdminBlogsPage() {
  const [data, setData] = useState<BlogsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/blogs")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const published = data?.statusBreakdown.find((s) => s.status === "PUBLISHED")?.count ?? 0;
  const draft = data?.statusBreakdown.find((s) => s.status === "DRAFT")?.count ?? 0;

  const donutData = (data?.statusBreakdown ?? []).map((s) => ({
    name: s.status,
    value: s.count,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">Blogs</h1>
        <p className="admin-page-subtitle">Generated blog posts across all users</p>
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
              label="Total Blogs"
              value={data?.totalBlogs ?? 0}
              icon={<FileText className="w-5 h-5" />}
              accentClass="admin-accent-purple"
            />
            <StatCard
              label="Published"
              value={published}
              icon={<BookOpen className="w-5 h-5" />}
              accentClass="admin-accent-green"
            />
            <StatCard
              label="Draft"
              value={draft}
              icon={<PenLine className="w-5 h-5" />}
              accentClass="admin-accent-orange"
            />
          </>
        )}
      </div>

      {/* Chart + Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="admin-card p-6">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
            Status Distribution
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
              <div className="mt-4 space-y-1">
                {donutData.map((item) => (
                  <div key={item.name} className="flex justify-between text-xs">
                    <span className="text-white/50">{item.name}</span>
                    <span className="font-semibold text-white">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="lg:col-span-2 admin-card p-6">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
            Top Producers
          </h2>
          {loading ? (
            <div className="admin-skeleton h-64 rounded-xl" />
          ) : (
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Site / User</th>
                    <th>Total</th>
                    <th>Published</th>
                    <th>Draft</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.topProducers.map((p, i) => (
                    <tr key={p.siteId}>
                      <td className="text-white/30 font-mono text-xs">{i + 1}</td>
                      <td>
                        <p className="font-medium text-white text-xs">{p.domain}</p>
                        <p className="text-xs text-white/40">{p.userEmail}</p>
                      </td>
                      <td className="font-bold text-white">{p.totalBlogs}</td>
                      <td className="text-emerald-400">{p.published}</td>
                      <td className="text-amber-400">{p.draft}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
