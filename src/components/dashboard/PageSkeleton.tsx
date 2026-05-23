export function PageSkeleton({ rows = 6, hasHeader = true }: { rows?: number; hasHeader?: boolean }) {
    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
            {hasHeader && (
                <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-2">
                        <div className="h-7 w-48 shimmer rounded-lg bg-card" />
                        <div className="h-4 w-72 shimmer rounded bg-card" />
                    </div>
                    <div className="h-10 w-32 shimmer rounded-xl bg-card" />
                </div>
            )}
            <div className="card-surface overflow-hidden">
                <div className="divide-y divide-border">
                    {Array.from({ length: rows }).map((_, i) => (
                        <div key={i} className="px-6 py-4 flex items-center gap-4">
                            <div className="h-4 w-4 shimmer rounded bg-card" />
                            <div className="h-4 flex-1 shimmer rounded bg-card" />
                            <div className="h-4 w-24 shimmer rounded bg-card" />
                            <div className="h-6 w-16 shimmer rounded-full bg-card" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
