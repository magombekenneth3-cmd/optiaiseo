export default function DashboardLoading() {
    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
            {/* Header skeleton */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                    <div className="h-7 w-52 shimmer rounded-lg" />
                    <div className="h-4 w-72 shimmer rounded" />
                </div>
                <div className="h-10 w-32 shimmer rounded-xl" />
            </div>

            {/* Metrics Row Skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="card-surface p-6 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <div className="h-3 w-24 shimmer rounded" />
                            <div className="w-10 h-10 rounded-xl shimmer" />
                        </div>
                        <div className="h-10 w-20 shimmer rounded" />
                        <div className="h-3 w-32 shimmer rounded" />
                    </div>
                ))}
            </div>

            {/* Main Sections Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 card-surface p-6 flex flex-col min-h-[380px]">
                    <div className="flex items-center justify-between mb-5">
                        <div className="h-5 w-36 shimmer rounded" />
                        <div className="h-5 w-20 shimmer rounded-full" />
                    </div>
                    <div className="flex-1 rounded-xl shimmer" />
                </div>

                <div className="card-surface p-6 flex flex-col">
                    <div className="h-5 w-40 shimmer rounded mb-5" />
                    <div className="flex flex-col gap-3">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-border bg-card">
                                <div className="flex flex-col gap-1.5">
                                    <div className="h-3.5 w-36 shimmer rounded" />
                                    <div className="h-2.5 w-20 shimmer rounded" />
                                </div>
                                <div className="h-7 w-14 shimmer rounded-lg" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Quick Actions Skeleton */}
            <div>
                <div className="h-3 w-28 shimmer rounded mb-3" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-20 shimmer rounded-xl" />
                    ))}
                </div>
            </div>
        </div>
    );
}
