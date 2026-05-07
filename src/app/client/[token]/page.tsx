import { notFound }   from "next/navigation";
import type { Metadata } from "next";
import prisma           from "@/lib/prisma";
import {
  Shield, TrendingUp, BarChart2, CheckCircle, XCircle,
  Globe, Zap, FileText, Info,
} from "lucide-react";

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> }
): Promise<Metadata> {
  const { token } = await params;
  const site = await prisma.site.findUnique({
    where:  { shareToken: token },
    select: { domain: true },
  });
  if (!site) return { title: "Report Not Found" };
  return {
    title:       `SEO Report — ${site.domain}`,
    description: `AI-powered SEO and AEO audit report for ${site.domain}`,
    robots:      { index: false, follow: false },
  };
}

export default async function ClientPortalPage(
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const site = await prisma.site.findUnique({
    where:  { shareToken: token },
    select: { id: true, domain: true },
  });

  if (!site) notFound();

  // Run all related queries in parallel
  const [audit, aeoReport, blogs] = await Promise.all([
    prisma.audit.findFirst({
      where:   { siteId: site.id },
      orderBy: { runTimestamp: "desc" },
      select: {
        categoryScores: true,
        fixStatus:      true,
        lcp:            true,
        cls:            true,
        inp:            true,
        runTimestamp:   true,
      },
    }),
    prisma.aeoReport.findFirst({
      where:   { siteId: site.id },
      orderBy: { createdAt: "desc" },
      select: {
        score:                  true,
        generativeShareOfVoice: true,
        checks:                 true,
        createdAt:              true,
      },
    }),
    prisma.blog.findMany({
      where:   { siteId: site.id, status: { in: ["DRAFT", "PUBLISHED"] } },
      orderBy: { createdAt: "desc" },
      take:    5,
      select: {
        title:          true,
        status:         true,
        citationScore:  true,
        targetKeywords: true,
        createdAt:      true,
      },
    }),
  ]);


  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catScores = (audit?.categoryScores as Record<string, number>) ?? {};
  const overallAudit = Object.values(catScores).length > 0
    ? Math.round(Object.values(catScores).reduce((a, b) => a + b, 0) / Object.values(catScores).length)
    : null;

  function scoreColor(v: number) {
    return v >= 75 ? "#10b981" : v >= 50 ? "#f59e0b" : "#ef4444";
  }
  function scoreBg(v: number) {
    return v >= 75
      ? "border-emerald-500/20 bg-emerald-500/5"
      : v >= 50
        ? "border-amber-500/20 bg-amber-500/5"
        : "border-red-500/20 bg-red-500/5";
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200 font-sans">
      {/* Header */}
      <div className="border-b border-[#21262d] bg-[#161b22]">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Globe className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">{site.domain}</h1>
              <p className="text-xs text-gray-500">AI-Powered SEO Report · Read-only view</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-[#0d1117] border border-[#21262d] rounded-lg px-3 py-2">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            Powered by AISEO
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 flex flex-col gap-8">

        {/* Top KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "SEO Score",
              value: overallAudit != null ? `${overallAudit}/100` : "—",
              icon:  BarChart2,
              color: overallAudit != null ? scoreColor(overallAudit) : "#6b7280",
            },
            {
              label: "AEO Score",
              value: aeoReport?.score != null ? `${aeoReport.score}/100` : "—",
              icon:  Zap,
              color: aeoReport?.score != null ? scoreColor(aeoReport.score) : "#6b7280",
            },
            {
              label: "AI Visibility (GSoV)",
              value: aeoReport?.generativeShareOfVoice != null
                ? `${aeoReport.generativeShareOfVoice}%`
                : "—",
              icon:  TrendingUp,
              color: "#3b82f6",
            },
            {
              label: "Content Pieces",
              value: blogs.length,
              icon:  FileText,
              color: "#8b5cf6",
            },
          ].map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.label} className="bg-[#161b22] border border-[#21262d] rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-4 h-4" style={{ color: kpi.color }} />
                  <span className="text-xs text-gray-500 font-medium">{kpi.label}</span>
                </div>
                <div className="text-2xl font-black" style={{ color: kpi.color }}>
                  {kpi.value}
                </div>
              </div>
            );
          })}
        </div>

        {/* SEO Category Scores */}
        {audit && Object.keys(catScores).length > 0 && (
          <section className="bg-[#161b22] border border-[#21262d] rounded-2xl p-6">
            <h2 className="text-base font-bold text-white mb-5 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-blue-400" />
              SEO Category Breakdown
            </h2>
            <div className="flex flex-col gap-3">
              {Object.entries(catScores).map(([cat, score]) => (
                <div key={cat}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm capitalize text-gray-300">
                      {cat.replace(/_/g, " ")}
                    </span>
                    <span className="text-sm font-bold" style={{ color: scoreColor(score) }}>
                      {score}/100
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#21262d]">
                    <div
                      className="h-2 rounded-full transition-all duration-500"
                      style={{
                        width: `${score}%`,
                        background: scoreColor(score),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-4">
              Last audited: {audit.runTimestamp.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </section>
        )}

        {/* Core Web Vitals */}
        {audit && (audit.lcp || audit.cls || audit.inp) && (
          <section className="bg-[#161b22] border border-[#21262d] rounded-2xl p-6">
            <h2 className="text-base font-bold text-white mb-5 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Core Web Vitals
            </h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "LCP (s)",  value: audit.lcp,  good: (v: number) => v <= 2.5 },
                { label: "CLS",      value: audit.cls,  good: (v: number) => v <= 0.1 },
                { label: "INP (ms)", value: audit.inp,  good: (v: number) => v <= 200 },
              ].map(({ label, value, good }) => (
                <div key={label} className={`rounded-xl border p-4 text-center ${
                  value == null ? "border-[#21262d]" :
                  good(value)   ? scoreBg(80) : scoreBg(30)
                }`}>
                  <div className="text-xs text-gray-500 mb-1">{label}</div>
                  <div className="text-xl font-black" style={{ color: value == null ? "#6b7280" : good(value) ? "#10b981" : "#ef4444" }}>
                    {value != null ? value.toFixed(value < 10 ? 3 : 0) : "—"}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* AEO Checks */}
        {aeoReport?.checks && Array.isArray(aeoReport.checks) && (
          <section className="bg-[#161b22] border border-[#21262d] rounded-2xl p-6">
            <h2 className="text-base font-bold text-white mb-5 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              AI Visibility Checks
            </h2>
            <div className="flex flex-col gap-2.5">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(aeoReport.checks as any[]).slice(0, 10).map((check: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-[#21262d] last:border-0">
                  {check.passed
                    ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    : <XCircle    className="w-4 h-4 text-red-400 shrink-0" />
                  }
                  <span className="text-sm text-gray-300 flex-1">{check.label}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    check.impact === "high"
                      ? "bg-red-500/10 text-red-400"
                      : check.impact === "medium"
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-gray-500/10 text-gray-500"
                  }`}>
                    {check.impact ?? "low"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent Content */}
        {blogs.length > 0 && (
          <section className="bg-[#161b22] border border-[#21262d] rounded-2xl p-6">
            <h2 className="text-base font-bold text-white mb-5 flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-400" />
              Recent Content
            </h2>
            <div className="flex flex-col gap-2">
              {blogs.map((blog, i) => (
                <div key={i} className="flex items-center gap-3 py-3 border-b border-[#21262d] last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 truncate">{blog.title}</p>
                    {blog.targetKeywords[0] && (
                      <p className="text-xs text-gray-500 mt-0.5">{blog.targetKeywords[0]}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {blog.citationScore != null && (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                        blog.citationScore >= 80
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : blog.citationScore >= 60
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                            : "bg-red-500/10 border-red-500/30 text-red-400"
                      }`}>
                        AI: {blog.citationScore}/100
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      blog.status === "PUBLISHED"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-amber-500/10 text-amber-500"
                    }`}>
                      {blog.status.toLowerCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {!audit && !aeoReport && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Info className="w-10 h-10 text-gray-600 mb-4" />
            <p className="text-gray-500">No audit data available yet. Check back shortly.</p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-gray-600 pb-8">
          This is a read-only report generated by AISEO.
          Data is refreshed weekly. · <a href="https://optiaiseo.online" className="text-emerald-600 hover:underline">optiaiseo.online</a>
        </div>

      </div>
    </div>
  );
}
