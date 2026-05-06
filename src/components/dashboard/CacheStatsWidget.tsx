"use client";

import { useState, useEffect } from "react";

interface CacheStats {
    available: boolean;
    estimatedKeys: number;
    breakdown: {
        mentions: number;
        perplexity: number;
        questions: number;
        embeddings: number;
    };
}

interface CacheStatsWidgetProps {
    domain: string;
    onCacheBusted?: () => void;
}

export function CacheStatsWidget({ domain, onCacheBusted }: CacheStatsWidgetProps) {
    const [stats, setStats] = useState<CacheStats | null>(null);
    const [busting, setBusting] = useState(false);
    const [busted, setBusted] = useState(false);

    useEffect(() => {
        fetch("/api/admin/cache")
            .then((r) => r.json())
            .then(setStats)
            .catch(() => null);
    }, []);

    const handleBust = async () => {
        setBusting(true);
        try {
            await fetch(`/api/admin/cache?domain=${encodeURIComponent(domain)}`, {
                method: "DELETE",
            });
            setBusted(true);
            onCacheBusted?.();
            const res = await fetch("/api/admin/cache");
            setStats(await res.json());
        } finally {
            setBusting(false);
        }
    };

    if (!stats || !stats.available) return null;

    return (
        <div className="text-xs text-muted-foreground flex items-center gap-3">
            <span>
                Cache: {stats.estimatedKeys} keys
                ({stats.breakdown.mentions} mentions · {stats.breakdown.perplexity} Perplexity)
            </span>
            <button
                onClick={handleBust}
                disabled={busting}
                className="px-2 py-0.5 rounded border border-border hover:bg-muted disabled:opacity-50 transition-colors"
            >
                {busted ? "Cleared" : busting ? "Clearing…" : "Clear cache"}
            </button>
        </div>
    );
}
