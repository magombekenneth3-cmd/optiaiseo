export default function CampaignsLoading() {
    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                    <div className="h-7 w-52 shimmer rounded-lg" />
                    <div className="h-4 w-80 shimmer rounded" />
                </div>
                <div className="h-9 w-36 shimmer rounded-xl" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-20 shimmer rounded-2xl" />
                ))}
            </div>
            <div className="flex flex-col gap-3">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 shimmer rounded-2xl" />
                ))}
            </div>
        </div>
    );
}