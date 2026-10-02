export default function DashboardLoading() {
    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">

            {/* ── Status row ─────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1.5">
                    <div className="h-3 w-24 shimmer rounded" />
                    <div className="h-6 w-52 shimmer rounded-lg" />
                    <div className="h-4 w-72 shimmer rounded" />
                    {/* Automation badge */}
                    <div className="mt-1 h-5 w-28 shimmer rounded-full" />
                </div>
                {/* CTA buttons */}
                <div className="flex shrink-0 items-center gap-2 sm:pt-1">
                    <div className="h-9 w-24 shimmer rounded-lg" />
                    <div className="h-9 w-24 shimmer rounded-lg" />
                </div>
            </div>

            {/* ── Pending-fix alert strip ─────────────────────────────────────── */}
            <div className="h-11 w-full shimmer rounded-xl" />

            {/* ── KPI cards — 3-col ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {/* SEO health — ring + delta */}
                <div className="kpi-card">
                    <div className="flex items-center gap-3">
                        <div className="h-12 w-12 shrink-0 rounded-full border-[4.5px] border-border shimmer" />
                        <div className="flex flex-col gap-1.5">
                            <div className="h-3 w-16 shimmer rounded" />
                            <div className="h-3.5 w-12 shimmer rounded" />
                        </div>
                    </div>
                </div>
                {/* Organic clicks */}
                <div className="kpi-card">
                    <div className="flex flex-col gap-2">
                        <div className="h-7 w-14 shimmer rounded" />
                        <div className="h-3 w-20 shimmer rounded" />
                        <div className="h-3 w-16 shimmer rounded" />
                    </div>
                </div>
                {/* Rank movement */}
                <div className="kpi-card">
                    <div className="flex flex-col gap-2">
                        <div className="h-7 w-10 shimmer rounded" />
                        <div className="h-3 w-24 shimmer rounded" />
                        <div className="h-3 w-20 shimmer rounded" />
                    </div>
                </div>
            </div>

            {/* ── Legacy attention queue (thin strip) ────────────────────────── */}
            <div className="flex flex-col gap-2">
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="action-card" style={{ cursor: "default" }}>
                        <div className="h-5 w-12 shimmer rounded-full" />
                        <div className="flex-1 flex flex-col gap-1.5">
                            <div className="h-3.5 w-44 shimmer rounded" />
                            <div className="h-3 w-32 shimmer rounded" />
                        </div>
                        <div className="h-4 w-16 shimmer rounded" />
                    </div>
                ))}
            </div>

            {/* ── Diagnostic priority queue ───────────────────────────────────── */}
            <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <div className="h-4 w-40 shimmer rounded" />
                    <div className="h-3 w-16 shimmer rounded" />
                </div>
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
                        <div className="h-4 w-4 shrink-0 shimmer rounded" />
                        <div className="flex-1 flex flex-col gap-1.5">
                            <div className="h-3.5 w-48 shimmer rounded" />
                            <div className="h-3 w-32 shimmer rounded" />
                        </div>
                        <div className="h-6 w-16 shimmer rounded-lg shrink-0" />
                    </div>
                ))}
            </div>

            {/* ── Health + AI Readiness — 2-col grid ─────────────────────────── */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="rounded-2xl border border-border bg-card p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="h-4 w-4 shimmer rounded" />
                            <div className="h-3.5 w-32 shimmer rounded" />
                        </div>
                        <div className="flex items-start gap-6">
                            {[...Array(i === 0 ? 3 : 2)].map((_, j) => (
                                <div key={j} className="flex flex-col gap-1.5">
                                    <div className="h-3 w-16 shimmer rounded" />
                                    <div className="h-5 w-10 shimmer rounded" />
                                    <div className="h-2.5 w-14 shimmer rounded" />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Remediation pipeline — 4 stat buckets ──────────────────────── */}
            <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                    <div className="h-4 w-40 shimmer rounded" />
                    <div className="h-3 w-20 shimmer rounded" />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/20 p-3">
                            <div className="h-3 w-16 shimmer rounded" />
                            <div className="h-6 w-8 shimmer rounded" />
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Trend chart ────────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-border bg-card p-5 flex flex-col" style={{ minHeight: 300 }}>
                <div className="flex items-center justify-between mb-4">
                    <div className="h-4 w-32 shimmer rounded" />
                    <div className="h-5 w-16 shimmer rounded" />
                </div>
                <div className="flex gap-4 mb-4 border-b border-border pb-2">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-3 w-20 shimmer rounded" />
                    ))}
                </div>
                <div className="flex-1 rounded-lg shimmer" />
            </div>

            {/* ── Activity + Audit history — 2-col grid ──────────────────────── */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Autonomous activity */}
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border px-5 py-4">
                        <div className="flex flex-col gap-1">
                            <div className="h-3 w-16 shimmer rounded" />
                            <div className="h-3.5 w-28 shimmer rounded" />
                        </div>
                        <div className="h-3 w-12 shimmer rounded" />
                    </div>
                    <div className="divide-y divide-border">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                                <div className="h-4 w-4 shrink-0 shimmer rounded-full" />
                                <div className="flex-1 flex flex-col gap-1">
                                    <div className="h-3.5 w-40 shimmer rounded" />
                                    <div className="h-3 w-24 shimmer rounded" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {/* Recent audit history */}
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border px-5 py-4">
                        <div className="flex flex-col gap-1">
                            <div className="h-3 w-12 shimmer rounded" />
                            <div className="h-3.5 w-36 shimmer rounded" />
                        </div>
                        <div className="h-3 w-14 shimmer rounded" />
                    </div>
                    <div className="divide-y divide-border">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="flex items-center gap-4 px-5 py-4">
                                <div className="h-4 w-4 shrink-0 shimmer rounded-full" />
                                <div className="flex-1 flex flex-col gap-1">
                                    <div className="h-3.5 w-36 shimmer rounded" />
                                    <div className="h-3 w-24 shimmer rounded" />
                                </div>
                                <div className="h-3.5 w-8 shimmer rounded shrink-0" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

        </div>
    );
}
