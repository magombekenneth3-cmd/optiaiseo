export default function KeywordsLoading() {
    return (
        <div className="flex flex-col gap-5 w-full max-w-6xl mx-auto">
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                    <div className="h-7 w-48 shimmer rounded-lg" />
                    <div className="h-4 w-80 shimmer rounded" />
                </div>
                <div className="h-9 w-32 shimmer rounded-xl" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-24 shimmer rounded-xl" />
                ))}
            </div>
            <div className="h-12 shimmer rounded-xl" />
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-3 h-48 shimmer rounded-xl" />
                <div className="lg:col-span-2 h-48 shimmer rounded-xl" />
            </div>
            <div className="h-[400px] shimmer rounded-xl" />
        </div>
    );
}
