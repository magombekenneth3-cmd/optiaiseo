export default function DashboardLoading() {
    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">
            {/* Header skeleton */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1.5">
                    <div className="h-6 w-32 shimmer rounded-lg" />
                    <div className="h-3.5 w-56 shimmer rounded" />
                </div>
                <div className="h-9 w-28 shimmer rounded-lg" />
            </div>

            {/* KPI Row — 4 cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="metric-card-skeleton p-4 flex flex-col gap-3">
                        <div className="flex items-center gap-1.5">
                            <div className="w-3.5 h-3.5 shimmer rounded" />
                            <div className="h-3 w-20 shimmer rounded" />
                        </div>
                        <div className="h-8 w-16 shimmer rounded" />
                        <div className="h-3 w-24 shimmer rounded" />
                    </div>
                ))}
            </div>

            {/* Chart skeleton */}
            <div className="border border-border rounded-[10px] bg-card p-5 flex flex-col" style={{ minHeight: 320 }}>
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

            {/* Next Best Action skeleton */}
            <div className="border border-border rounded-[10px] bg-card px-4 py-3 flex items-center gap-3">
                <div className="w-4 h-4 shimmer rounded" />
                <div className="flex-1 flex flex-col gap-1">
                    <div className="h-2.5 w-24 shimmer rounded" />
                    <div className="h-3.5 w-48 shimmer rounded" />
                </div>
                <div className="h-8 w-24 shimmer rounded-lg" />
            </div>

            {/* Secondary panels skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="border border-border rounded-[10px] bg-card p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-4 h-4 shimmer rounded" />
                            <div className="h-3.5 w-28 shimmer rounded" />
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            {[...Array(3)].map((_, j) => (
                                <div key={j} className="flex flex-col gap-1.5">
                                    <div className="h-3 w-16 shimmer rounded" />
                                    <div className="h-5 w-10 shimmer rounded" />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
