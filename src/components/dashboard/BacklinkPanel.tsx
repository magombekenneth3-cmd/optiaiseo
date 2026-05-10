"use client";

import { useState, useEffect, useTransition } from "react";
import { Link2, TrendingUp, TrendingDown, AlertTriangle, Shield, ExternalLink, RefreshCw, ChevronDown, ChevronUp, Target } from "lucide-react";
import { getBacklinkOverview, getBacklinkList, getBacklinkGap } from "@/app/actions/backlinks";

type Overview  = Awaited<ReturnType<typeof getBacklinkOverview>>;
type LinkList  = Awaited<ReturnType<typeof getBacklinkList>>;
type GapReport = Awaited<ReturnType<typeof getBacklinkGap>>;

function StatCard({ label, value, sub, color = "", border = "" }: {
    label: string; value: string | number; sub?: string; color?: string; border?: string;
}) {
    return (
        <div className={`card-surface p-4 flex flex-col gap-1 ${border}`}>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
    );
}

function drColor(dr: number) {
    if (dr >= 60) return "text-emerald-400";
    if (dr >= 30) return "text-amber-400";
    return "text-red-400";
}

function SectionHeader({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub?: string }) {
    return (
        <div className="flex items-center gap-2 mb-4">
            <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
                <p className="text-sm font-semibold">{title}</p>
                {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
            </div>
        </div>
    );
}

export function BacklinkPanel({ siteId, competitorDomains }: {
    siteId: string;
    competitorDomains: string[];
}) {
    const [overview,   setOverview]   = useState<Overview | null>(null);
    const [linkList,   setLinkList]   = useState<LinkList | null>(null);
    const [gapReport,  setGapReport]  = useState<GapReport | null>(null);
    const [competitor, setCompetitor] = useState(competitorDomains[0] ?? "");
    const [showLinks,  setShowLinks]  = useState(false);
    const [isPending,  startTransition] = useTransition();
    const [gapPending, startGapTransition] = useTransition();

    // Load overview + link list on mount
    useEffect(() => {
        startTransition(async () => {
            const [ov, ll] = await Promise.all([
                getBacklinkOverview(siteId),
                getBacklinkList(siteId, 50),
            ]);
            setOverview(ov);
            setLinkList(ll);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId]);

    const fetchGap = () => {
        if (!competitor) return;
        startGapTransition(async () => {
            const r = await getBacklinkGap(siteId, competitor);
            setGapReport(r);
        });
    };

    const summary = overview?.success ? overview.summary : null;
    const quality = overview?.success ? overview.quality : null;
    const alerts  = overview?.success ? overview.alerts  : [];
    const details = linkList?.success  ? linkList.details : [];

    if (isPending && !overview) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="card-surface p-4 h-20 rounded-xl bg-muted/40" />
                    ))}
                </div>
                <div className="card-surface p-6 h-40 rounded-xl bg-muted/30" />
            </div>
        );
    }

    if (overview && !overview.success) {
        return (
            <div className="py-12 text-center text-sm text-muted-foreground">
                <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-400" />
                <p className="font-medium text-foreground mb-1">Could not load backlink data</p>
                <p>{overview.error}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">

            {/* ── Stat cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                    label="Domain Rating"
                    value={summary?.domainRating ?? "–"}
                    sub="Authority score"
                    color={summary ? drColor(summary.domainRating) : ""}
                    border={summary && summary.domainRating >= 60
                        ? "border-l-4 border-l-emerald-500"
                        : summary && summary.domainRating >= 30
                            ? "border-l-4 border-l-amber-500"
                            : "border-l-4 border-l-red-500"}
                />
                <StatCard
                    label="Backlinks"
                    value={summary?.totalBacklinks?.toLocaleString() ?? "–"}
                    sub={`${summary?.newLastWeek ?? 0} new this week`}
                />
                <StatCard
                    label="Referring Domains"
                    value={summary?.referringDomains?.toLocaleString() ?? "–"}
                    sub="Unique linking sites"
                />
                <StatCard
                    label="Toxic Links"
                    value={summary?.toxicCount ?? quality?.toxic ?? "–"}
                    sub={quality ? `${quality.doFollow} dofollow` : ""}
                    color={(summary?.toxicCount ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}
                    border={(summary?.toxicCount ?? 0) > 0 ? "border-l-4 border-l-red-500" : "border-l-4 border-l-emerald-500"}
                />
            </div>

            {/* ── New / Lost alerts strip ── */}
            {(summary?.newLastWeek || summary?.lostLastWeek) ? (
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                        <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-emerald-300">{summary.newLastWeek} gained</p>
                            <p className="text-xs text-muted-foreground">New backlinks this week</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/20">
                        <TrendingDown className="w-4 h-4 text-red-400 shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-red-300">{summary?.lostLastWeek ?? 0} lost</p>
                            <p className="text-xs text-muted-foreground">Lost backlinks this week</p>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* ── Competitor gap ── */}
            <div className="card-surface overflow-hidden">
                <div className="p-5 border-b border-border">
                    <SectionHeader icon={Target} title="Competitor Backlink Gap" sub="Find domains that link to competitors but not you — warm outreach targets" />
                    <div className="flex items-center gap-2 flex-wrap">
                        {competitorDomains.length > 0 ? (
                            <select
                                value={competitor}
                                onChange={e => setCompetitor(e.target.value)}
                                className="flex-1 min-w-0 max-w-xs px-3 py-1.5 text-sm rounded-lg bg-card border border-border focus:outline-none focus:border-ring"
                            >
                                {competitorDomains.map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        ) : (
                            <input
                                value={competitor}
                                onChange={e => setCompetitor(e.target.value)}
                                placeholder="competitor.com"
                                className="flex-1 min-w-0 max-w-xs px-3 py-1.5 text-sm rounded-lg bg-card border border-border focus:outline-none focus:border-ring placeholder:text-muted-foreground"
                            />
                        )}
                        <button
                            onClick={fetchGap}
                            disabled={gapPending || !competitor}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm font-semibold hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                        >
                            {gapPending ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analysing…</> : <><Target className="w-3.5 h-3.5" /> Analyse Gap</>}
                        </button>
                    </div>
                </div>

                {gapReport && gapReport.success && (
                    <div className="p-5">
                        {/* Gap metric pills */}
                        <div className="grid grid-cols-3 gap-3 mb-5">
                            {[
                                { label: "RD Gap", value: gapReport.report.gap.referringDomains, desc: "referring domains behind" },
                                { label: "DR Gap", value: gapReport.report.gap.domainRating, desc: "domain rating behind" },
                                { label: "Opportunities", value: gapReport.report.gap.opportunityDomains.length, desc: "domains to target" },
                            ].map(m => (
                                <div key={m.label} className="p-3 rounded-xl bg-card border border-border text-center">
                                    <p className={`text-xl font-bold ${m.value > 0 ? "text-red-400" : "text-emerald-400"}`}>
                                        {m.value > 0 ? `+${m.value}` : m.value}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">{m.desc}</p>
                                </div>
                            ))}
                        </div>

                        {/* Opportunity domains */}
                        {gapReport.report.gap.opportunityDomains.length > 0 && (
                            <>
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                    Link Opportunities — {gapReport.report.competitor.referringDomains} RDs linking to {gapReport.report.competitorDomain}
                                </p>
                                <div className="space-y-1 max-h-52 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border">
                                    {gapReport.report.gap.opportunityDomains.map(({ domain, dr }, i) => (
                                        <div key={domain} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors group">
                                            <span className="w-5 text-[10px] text-muted-foreground font-mono shrink-0">{i + 1}</span>
                                            <span className="flex-1 text-sm font-medium truncate">{domain}</span>
                                            {dr != null && (
                                                <span className={`text-xs font-bold shrink-0 ${drColor(dr)}`}>DR {Math.round(dr)}</span>
                                            )}
                                            <a
                                                href={`https://${domain}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                            >
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {gapReport && !gapReport.success && (
                    <div className="p-5 text-sm text-red-400">{gapReport.error}</div>
                )}
            </div>

            {/* ── Top anchors ── */}
            {summary?.topAnchors && summary.topAnchors.length > 0 && (
                <div className="card-surface p-5">
                    <SectionHeader icon={Link2} title="Top Anchor Texts" sub="Most common link text pointing to your site" />
                    <div className="space-y-2">
                        {summary.topAnchors.slice(0, 8).map((a, i) => {
                            const maxCount = summary.topAnchors[0].count;
                            const pct = Math.round((a.count / maxCount) * 100);
                            return (
                                <div key={i} className="flex items-center gap-3">
                                    <span className="text-xs text-muted-foreground w-4 font-mono shrink-0">{i + 1}</span>
                                    <span className="text-sm flex-1 truncate font-medium" title={a.anchor}>{a.anchor || "(empty)"}</span>
                                    <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                                        <div className="h-full rounded-full bg-blue-500/60" style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="text-xs text-muted-foreground w-8 text-right shrink-0">{a.count}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Recent alerts ── */}
            {alerts && alerts.length > 0 && (
                <div className="card-surface p-5">
                    <SectionHeader icon={Shield} title="Recent Link Changes" sub="Domains gained or lost in the last check" />
                    <div className="space-y-1.5">
                        {alerts.map(a => (
                            <div key={a.id} className="flex items-center gap-3 text-sm">
                                {a.type === "gained"
                                    ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                    : <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                                <span className={`font-medium ${a.type === "gained" ? "text-emerald-300" : "text-red-300"}`}>
                                    {a.type === "gained" ? "+" : "−"}
                                </span>
                                <span className="flex-1 truncate text-foreground/80">{a.domain}</span>
                                {a.dr != null && (
                                    <span className={`text-xs font-bold ${drColor(a.dr)}`}>DR {Math.round(a.dr)}</span>
                                )}
                                <span className="text-xs text-muted-foreground shrink-0">
                                    {new Date(a.detectedAt).toLocaleDateString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Recent backlinks list (expandable) ── */}
            {details.length > 0 && (
                <div className="card-surface overflow-hidden">
                    <button
                        onClick={() => setShowLinks(v => !v)}
                        className="w-full flex items-center justify-between p-5 hover:bg-muted/30 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-semibold">Recent Backlinks</span>
                            <span className="text-xs text-muted-foreground">({details.length} shown)</span>
                        </div>
                        {showLinks ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </button>

                    {showLinks && (
                        <div className="border-t border-border overflow-x-auto">
                            <table className="w-full text-sm text-left whitespace-nowrap">
                                <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                                    <tr>
                                        <th className="px-5 py-3">Source</th>
                                        <th className="px-5 py-3">Anchor</th>
                                        <th className="px-5 py-3 text-center">DR</th>
                                        <th className="px-5 py-3 text-center">Type</th>
                                        <th className="px-5 py-3 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {details.map((d, i) => (
                                        <tr key={i} className="hover:bg-card transition-colors">
                                            <td className="px-5 py-3 max-w-[220px] truncate">
                                                <a
                                                    href={d.sourceUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-400 hover:underline flex items-center gap-1"
                                                >
                                                    {d.sourceUrl.replace(/^https?:\/\//, "").substring(0, 40)}
                                                    <ExternalLink className="w-3 h-3 shrink-0" />
                                                </a>
                                            </td>
                                            <td className="px-5 py-3 text-muted-foreground max-w-[160px] truncate" title={d.anchorText}>
                                                {d.anchorText || "(none)"}
                                            </td>
                                            <td className="px-5 py-3 text-center">
                                                <span className={`font-bold text-xs ${drColor(d.domainRating)}`}>
                                                    {d.domainRating}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3 text-center">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                                    d.anchorText ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                                        : "bg-muted text-muted-foreground border-border"
                                                }`}>
                                                    dofollow
                                                </span>
                                            </td>
                                            <td className="px-5 py-3 text-center">
                                                {d.isToxic ? (
                                                    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border bg-red-500/10 text-red-400 border-red-500/20">
                                                        Toxic
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                                        Clean
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── Empty state ── */}
            {!isPending && !summary && (
                <div className="py-16 text-center text-muted-foreground">
                    <Link2 className="w-10 h-10 mx-auto mb-4 opacity-30" />
                    <p className="font-medium text-foreground mb-1">No backlink data yet</p>
                    <p className="text-sm max-w-sm mx-auto">
                        Backlink data is fetched via DataForSEO. Make sure <code className="text-xs bg-card px-1 py-0.5 rounded border border-border">DATAFORSEO_LOGIN</code> and <code className="text-xs bg-card px-1 py-0.5 rounded border border-border">DATAFORSEO_PASSWORD</code> are set in your environment.
                    </p>
                </div>
            )}

        </div>
    );
}
