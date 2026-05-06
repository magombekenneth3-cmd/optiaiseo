"use client";
import { useState, useTransition } from "react";
import { ExternalLink, Loader2 }  from "lucide-react";
import { fetchCompetitorTopPages } from "@/app/actions/competitors";
import type { CompetitorTopPage }  from "@/lib/keywords/dataforseo";

interface Props {
    siteId:       string;
    competitorId: string;
    domain:       string;
}

export function CompetitorTopPages({ siteId, competitorId, domain }: Props) {
    const [pages,     setPages]     = useState<CompetitorTopPage[]>([]);
    const [loaded,    setLoaded]    = useState(false);
    const [error,     setError]     = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    function load() {
        startTransition(async () => {
            setError(null);
            const res = await fetchCompetitorTopPages(siteId, competitorId);
            if (res.success) { setPages(res.pages ?? []); setLoaded(true); }
            else             { setError(res.error ?? "Failed"); }
        });
    }

    return (
        <div className="mt-4">
            {!loaded && (
                <button
                    onClick={load}
                    disabled={isPending}
                    id={`competitor-top-pages-btn-${competitorId}`}
                    className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5
                               rounded-lg border border-border hover:border-foreground/30
                               text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                    {isPending
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading top pages…</>
                        : "Show top pages by traffic"}
                </button>
            )}

            {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

            {loaded && pages.length > 0 && (
                <div className="mt-3 rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-2 bg-card/50 border-b border-border">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Top Pages by Estimated Traffic — {domain}
                        </p>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground border-b border-border">
                            <tr>
                                <th scope="col" className="px-4 py-2 text-left font-medium">Page</th>
                                <th scope="col" className="px-4 py-2 text-right font-medium">Est. Volume</th>
                                <th scope="col" className="px-4 py-2 text-left font-medium">Top Keywords</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {pages.map((page, i) => (
                                <tr key={i} className="hover:bg-card transition-colors">
                                    <td className="px-4 py-2.5 max-w-[260px]">
                                        <a
                                            href={`https://${domain}${page.url}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-muted-foreground hover:text-foreground hover:underline flex items-center gap-1 truncate"
                                        >
                                            <span className="truncate">{page.url || "/"}</span>
                                            <ExternalLink className="w-3 h-3 shrink-0" />
                                        </a>
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-medium">
                                        ~{page.totalVolume.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate"
                                        title={page.keywords.join(", ")}>
                                        {page.keywords.slice(0, 2).join(", ")}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
