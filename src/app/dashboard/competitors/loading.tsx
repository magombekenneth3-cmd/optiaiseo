export default function CompetitorsLoading() {
    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 animate-pulse">
            {/* Header skeleton */}
            <div>
                <div className="h-7 w-48 rounded-md bg-[#161b22]" />
                <div className="mt-2 h-4 w-80 rounded-md bg-[#161b22]" />
                <div className="mt-2 h-3 w-60 rounded-md bg-[#161b22]" />
            </div>

            {/* KPI strip skeleton */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-[#21262d] bg-[#0d1117] px-4 py-3.5 space-y-3">
                        <div className="h-3 w-24 rounded bg-[#161b22]" />
                        <div className="h-8 w-16 rounded bg-[#161b22]" />
                        <div className="h-3 w-32 rounded bg-[#161b22]" />
                    </div>
                ))}
            </div>

            {/* Movement skeleton */}
            <div className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#161b22]">
                    <div className="h-4 w-48 rounded bg-[#161b22]" />
                    <div className="h-5 w-32 rounded-full bg-[#161b22]" />
                </div>
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-3">
                        <div className="h-4 w-4 rounded-sm bg-[#161b22]" />
                        <div className="flex-1 h-3 rounded bg-[#161b22]" />
                        <div className="h-3 w-12 rounded bg-[#161b22]" />
                        <div className="h-6 w-20 rounded bg-[#161b22]" />
                        <div className="h-3 w-10 rounded bg-[#161b22]" />
                    </div>
                ))}
            </div>

            {/* Opportunities skeleton */}
            <div className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#161b22]">
                    <div className="h-4 w-44 rounded bg-[#161b22]" />
                    <div className="h-5 w-28 rounded-full bg-[#161b22]" />
                </div>
                {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="px-5 py-4 space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="h-4 w-16 rounded bg-[#161b22]" />
                            <div className="h-4 w-48 rounded bg-[#161b22]" />
                        </div>
                        <div className="h-3 w-72 rounded bg-[#161b22]" />
                        <div className="h-3 w-40 rounded bg-[#161b22]" />
                    </div>
                ))}
            </div>

            {/* Table skeleton */}
            <div className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#161b22]">
                    <div className="h-4 w-40 rounded bg-[#161b22]" />
                </div>
                <div className="flex gap-2 px-5 py-3 border-b border-[#161b22]">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-6 w-16 rounded-lg bg-[#161b22]" />
                    ))}
                </div>
                {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-[#161b22] last:border-b-0">
                        <div className="h-4 w-4 rounded-sm bg-[#161b22]" />
                        <div className="h-3 w-32 rounded bg-[#161b22] flex-1" />
                        <div className="h-3 w-12 rounded bg-[#161b22]" />
                        <div className="h-3 w-12 rounded bg-[#161b22]" />
                        <div className="h-3 w-8 rounded bg-[#161b22]" />
                        <div className="h-5 w-16 rounded-full bg-[#161b22]" />
                        <div className="h-6 w-24 rounded-md bg-[#161b22]" />
                    </div>
                ))}
            </div>
        </div>
    );
}
