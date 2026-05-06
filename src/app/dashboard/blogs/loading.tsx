export default function BlogsLoading() {
    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                    <div className="h-7 w-44 shimmer rounded-lg" />
                    <div className="h-4 w-64 shimmer rounded" />
                </div>
                <div className="h-10 w-36 shimmer rounded-xl" />
            </div>
            <div className="card-surface flex flex-col min-h-[500px]">
                <div className="border-b border-border p-4 flex gap-3">
                    <div className="h-8 w-24 shimmer rounded-lg" />
                    <div className="h-8 w-24 shimmer rounded-lg" />
                </div>
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="h-48 shimmer rounded-xl" />
                    ))}
                </div>
            </div>
        </div>
    );
}
