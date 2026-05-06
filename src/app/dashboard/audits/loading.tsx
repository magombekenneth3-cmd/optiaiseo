export default function AuditsLoading() {
    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
            {/* Header skeleton */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                    <div className="h-7 w-40 shimmer rounded-lg" />
                    <div className="h-4 w-64 shimmer rounded" />
                </div>
                <div className="h-10 w-36 shimmer rounded-xl" />
            </div>

            {/* Table skeleton */}
            <div className="card-surface overflow-hidden">
                <div className="p-0 overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border">
                                {['Domain', 'Status', 'SEO Score', 'Issues', 'Date', ''].map((h, i) => (
                                    <th key={i} className="px-6 py-4 text-left">
                                        <div className="h-3 w-16 shimmer rounded" />
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {[...Array(6)].map((_, i) => (
                                <tr key={i}>
                                    <td className="px-6 py-4"><div className="h-4 w-36 shimmer rounded" /></td>
                                    <td className="px-6 py-4"><div className="h-6 w-20 shimmer rounded-full" /></td>
                                    <td className="px-6 py-4"><div className="h-4 w-12 shimmer rounded" /></td>
                                    <td className="px-6 py-4"><div className="h-4 w-16 shimmer rounded" /></td>
                                    <td className="px-6 py-4"><div className="h-4 w-24 shimmer rounded" /></td>
                                    <td className="px-6 py-4 text-right"><div className="h-8 w-24 shimmer rounded-lg ml-auto" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
