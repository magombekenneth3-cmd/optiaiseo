import Link from "next/link";
import { Metadata } from "next";
import {
  Globe,
  GitBranch,
  Plus,
  ExternalLink,
  Clock,
  BarChart2,
} from "lucide-react";

export const metadata: Metadata = {
  title: "My Sites | OptiAISEO",
  description: "Manage your registered websites.",
};

export const dynamic = "force-dynamic";

import { getUserSites } from "@/app/actions/site";
import { extractAuditMetrics } from "@/lib/audit/helpers";

export default async function SitesPage() {
  const { success, sites } = await getUserSites();

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">My Sites</h1>
          <p className="text-muted-foreground text-sm">
            Manage domains, operating modes, and GitHub integrations.
          </p>
        </div>
        <Link
          href="/dashboard/sites/new"
          className="inline-flex items-center gap-2 bg-foreground hover:opacity-90 text-background px-5 py-2.5 rounded-xl font-semibold text-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Site
        </Link>
      </div>

      {/* Sites Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 fade-in-up fade-in-up-1">
        {success && sites && sites.length > 0
          ? sites.map((site, idx) => {
              const latestAudit = site.audits?.[0];
              const domain = site.domain.replace(/^https?:\/\//, "");
              const { seoScore } = latestAudit
                ? extractAuditMetrics({
                    categoryScores: latestAudit.categoryScores as Record<
                      string,
                      unknown
                    > | null,
                    issueList: latestAudit.issueList,
                  })
                : { seoScore: 0 };

              return (
                <div
                  key={site.id}
                  className="card-surface overflow-hidden group fade-in-up"
                  style={{ animationDelay: `${idx * 0.05}s` }}
                >
                  {/* Card top strip — solid muted surface, no gradient */}
                  <div className="h-28 bg-muted/30 border-b border-border p-5 flex items-start justify-between">
                    <div className="flex flex-col gap-2">
                      <span
                        className={`status-pill w-fit ${site.operatingMode === "FULL_ACCESS" ? "bg-brand-muted text-brand border-brand-border" : "bg-muted text-muted-foreground border-border"}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${site.operatingMode === "FULL_ACCESS" ? "bg-brand animate-pulse" : "bg-muted-foreground"}`}
                        />
                        {site.operatingMode === "FULL_ACCESS"
                          ? "Full Access"
                          : "Report Only"}
                      </span>
                      <h3 className="text-base font-bold truncate max-w-[200px]">
                        {domain}
                      </h3>
                    </div>
                    <Globe className="w-5 h-5 text-muted-foreground mt-1" />
                  </div>

                  {/* Card body */}
                  <div className="p-5 flex flex-col gap-4">
                    {/* Metrics row */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1 p-3 rounded-xl bg-muted/30 border border-border">
                        <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Last Audit
                        </span>
                        <span className="text-sm font-semibold">
                          {latestAudit
                            ? new Date(
                                latestAudit.runTimestamp,
                              ).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })
                            : "Never"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 p-3 rounded-xl bg-muted/30 border border-border">
                        <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider flex items-center gap-1">
                          <BarChart2 className="w-3 h-3" /> SEO Score
                        </span>
                        <span
                          className={`text-sm font-bold ${seoScore > 0 ? (seoScore >= 80 ? "text-emerald-500" : seoScore >= 60 ? "text-amber-500" : "text-red-500") : "text-muted-foreground"}`}
                        >
                          {seoScore > 0 ? `${seoScore}/100` : "—"}
                        </span>
                      </div>
                    </div>

                    <div className="h-px w-full bg-border" />

                    {/* GitHub & actions */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <GitBranch className="w-3.5 h-3.5" />
                        {site.githubRepoUrl ? (
                          <span
                            className="truncate max-w-[120px]"
                            title={site.githubRepoUrl}
                          >
                            {site.githubRepoUrl.split("/").slice(-2).join("/")}
                          </span>
                        ) : (
                          <span className="italic">No repo connected</span>
                        )}
                      </div>
                      <Link
                        href={`/dashboard/sites/${site.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:opacity-80 transition-opacity"
                      >
                        Manage <ExternalLink className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })
          : null}

        {/* Add site card */}
        <Link
          href="/dashboard/sites/new"
          className="card-surface border-dashed hover:border-brand/40 hover:bg-muted/40 transition-all flex flex-col items-center justify-center p-8 min-h-[260px] gap-4 group cursor-pointer fade-in-up"
        >
          <div className="w-14 h-14 rounded-2xl bg-muted/40 border border-border flex items-center justify-center group-hover:scale-110 group-hover:bg-brand-muted group-hover:border-brand-border transition-all duration-300">
            <Plus className="w-6 h-6 text-muted-foreground group-hover:text-brand transition-colors" />
          </div>
          <div className="text-center">
            <h3 className="font-semibold text-base mb-1 text-foreground">
              {success && sites && sites.length > 0
                ? "Register New Site"
                : "Register First Site"}
            </h3>
            <p className="text-xs text-muted-foreground">
              Add a domain to start auditing
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
