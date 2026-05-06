export default function SitesLoading() {
    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                    <div className="h-7 w-36 shimmer rounded-lg" />
                    <div className="h-4 w-60 shimmer rounded" />
                </div>
                <div className="h-10 w-32 shimmer rounded-xl" />
            </div>

            {/* Site cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="card-surface p-5 flex flex-col gap-4">
                        {/* Domain + favicon row */}
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 shimmer rounded-lg shrink-0" />
                            <div className="flex flex-col gap-1.5 flex-1">
                                <div className="h-4 w-40 shimmer rounded" />
                                <div className="h-3 w-24 shimmer rounded" />
                            </div>
                            <div className="h-6 w-14 shimmer rounded-full" />
                        </div>

                        {/* Score bar */}
                        <div className="flex flex-col gap-2">
                            <div className="flex justify-between">
                                <div className="h-3 w-20 shimmer rounded" />
                                <div className="h-3 w-8 shimmer rounded" />
                            </div>
                            <div className="h-1.5 w-full shimmer rounded-full" />
                        </div>

                        {/* Metric chips */}
                        <div className="flex items-center gap-2">
                            <div className="h-6 w-16 shimmer rounded-full" />
                            <div className="h-6 w-16 shimmer rounded-full" />
                            <div className="h-6 w-16 shimmer rounded-full" />
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2 pt-1 border-t border-border">
                            <div className="h-8 flex-1 shimmer rounded-lg" />
                            <div className="h-8 w-8 shimmer rounded-lg" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
