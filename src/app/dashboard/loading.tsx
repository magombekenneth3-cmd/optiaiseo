export default function DashboardLoading() {
    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">
            {/* Hero header skeleton */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                    <div className="h-6 w-40 shimmer rounded-lg" />
                    <div className="h-4 w-64 shimmer rounded" />
                </div>
                <div className="h-9 w-28 shimmer rounded-lg shrink-0" />
            </div>

            {/* KPI Row — 4 cards with ring placeholders */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="kpi-card">
                        {i < 2 ? (
                            /* Score ring placeholder for first 2 */
                            <div className="flex items-center gap-3">
                                <div className="w-[52px] h-[52px] rounded-full border-[4.5px] border-border shimmer shrink-0" />
                                <div className="flex flex-col gap-1.5">
                                    <div className="h-3 w-16 shimmer rounded" />
                                    <div className="h-3 w-12 shimmer rounded" />
                                </div>
                            </div>
                        ) : (
                            /* Stat value placeholder for last 2 */
                            <div className="flex flex-col gap-2">
                                <div className="h-7 w-14 shimmer rounded" />
                                <div className="h-3 w-20 shimmer rounded" />
                                <div className="h-3 w-28 shimmer rounded" />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Recommended actions skeleton */}
            <hr className="section-divider" />
            <div className="flex flex-col gap-2">
                <div className="h-3 w-36 shimmer rounded mb-1" />
                <div className="border border-border rounded-xl bg-card px-4 py-3 flex items-center gap-3">
                    <div className="w-4 h-4 shimmer rounded" />
                    <div className="flex-1 flex flex-col gap-1">
                        <div className="h-2.5 w-24 shimmer rounded" />
                        <div className="h-3.5 w-48 shimmer rounded" />
                    </div>
                    <div className="h-8 w-24 shimmer rounded-lg" />
                </div>
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

            {/* Chart skeleton */}
            <hr className="section-divider" />
            <div className="border border-border rounded-2xl bg-card p-5 flex flex-col" style={{ minHeight: 320 }}>
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

            {/* Secondary panels skeleton */}
            <hr className="section-divider" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="border border-border rounded-2xl bg-card p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-4 h-4 shimmer rounded" />
                            <div className="h-3.5 w-28 shimmer rounded" />
                        </div>
                        <div className="flex items-start gap-6">
                            {[...Array(i === 0 ? 2 : 3)].map((_, j) => (
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

            {/* Recent Audits table skeleton */}
            <div className="border border-border rounded-2xl bg-card overflow-hidden">
                <div className="px-5 py-4 flex items-center justify-between">
                    <div className="h-3.5 w-24 shimmer rounded" />
                    <div className="h-3 w-14 shimmer rounded" />
                </div>
                <div className="border-t border-border">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-0">
                            <div className="w-4 h-4 shimmer rounded-full" />
                            <div className="h-3.5 w-36 shimmer rounded" />
                            <div className="h-3.5 w-12 shimmer rounded ml-auto" />
                            <div className="h-3.5 w-10 shimmer rounded" />
                            <div className="h-3.5 w-16 shimmer rounded" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
