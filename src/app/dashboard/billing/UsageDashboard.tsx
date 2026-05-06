"use client";

import { useState, useEffect } from "react";
import { getUserUsage, UserUsage } from "@/app/actions/usage";
import { Gauge, Globe, FileText, Zap } from "lucide-react";

export function UsageDashboard() {
    const [usage, setUsage] = useState<UserUsage | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getUserUsage().then(data => {
            setUsage(data);
            setLoading(false);
        });
    }, []);

    if (loading) {
        return (
            <div className="card-surface p-6 mb-8 mt-4 animate-pulse">
                <div className="h-5 w-48 bg-white/10 rounded mb-6"></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="h-20 bg-muted rounded-xl"></div>
                    <div className="h-20 bg-muted rounded-xl"></div>
                    <div className="h-20 bg-muted rounded-xl"></div>
                </div>
            </div>
        );
    }

    if (!usage) return null;

    return (
        <div className="card-surface p-6 mb-10 overflow-hidden relative">
            <h2 className="text-lg font-bold tracking-tight mb-6 flex items-center gap-2">
                <Gauge className="w-5 h-5 text-emerald-400" />
                Current Usage <span className="text-muted-foreground font-normal text-sm ml-1">— {usage.tier} Plan</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
                <UsageCard title="Sites Monitored" icon={<Globe className="w-4 h-4" />} used={usage.sites.used} limit={usage.sites.limit} color="blue" />
                <UsageCard title="Blogs Generated" icon={<FileText className="w-4 h-4" />} used={usage.blogs.used} limit={usage.blogs.limit} color="emerald" subtitle="This month" />
                <UsageCard title="AI Audits Run" icon={<Zap className="w-4 h-4" />} used={usage.audits.used} limit={usage.audits.limit} color="amber" subtitle="This month" />
            </div>

            {/* Decorative background flare */}
            <div className="absolute top-[-50%] right-[-10%] w-[300px] h-[300px] bg-emerald-500/5 rounded-full blur-3xl -z-0 pointer-events-none" />
        </div>
    );
}

function UsageCard({ title, icon, used, limit, color, subtitle }: { title: string; icon: React.ReactNode; used: number; limit: number; color: "blue" | "emerald" | "amber"; subtitle?: string }) {
    const isUnlimited = limit === -1;
    const percentage = isUnlimited ? 0 : Math.min(100, (used / limit) * 100);

    const colors = {
        blue: {
            bg: "bg-blue-500/10",
            border: "border-blue-500/20",
            text: "text-blue-400",
            fill: "bg-blue-500",
            pulse: percentage >= 90 ? "bg-red-500" : "bg-blue-400"
        },
        emerald: {
            bg: "bg-emerald-500/10",
            border: "border-emerald-500/20",
            text: "text-emerald-400",
            fill: "bg-emerald-500",
            pulse: percentage >= 90 ? "bg-red-500" : "bg-emerald-400"
        },
        amber: {
            bg: "bg-amber-500/10",
            border: "border-amber-500/20",
            text: "text-amber-400",
            fill: "bg-amber-500",
            pulse: percentage >= 90 ? "bg-red-500" : "bg-amber-400"
        }
    };

    const isNearLimit = !isUnlimited && percentage >= 90;
    // Improvement 5: amber nudge at 80–89%, red at ≥90%
    const isApproachingLimit = !isUnlimited && percentage >= 80 && percentage < 90;
    const finalFillColor = isNearLimit ? "bg-red-500" : isApproachingLimit ? "bg-amber-500" : colors[color].fill;
    const finalTextColor = isNearLimit ? "text-red-400" : isApproachingLimit ? "text-amber-400" : colors[color].text;

    return (
        <div className={`p-4 rounded-xl border ${colors[color].bg} ${colors[color].border} flex flex-col justify-between`}>
            <div className="flex justify-between items-start mb-4">
                <div>
                    <p className="text-sm font-medium text-foreground/80 flex items-center gap-1.5">
                        <span className={finalTextColor}>{icon}</span>
                        {title}
                    </p>
                    {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
                </div>
                <div className="text-right">
                    <p className={`text-xl font-black tracking-tight ${finalTextColor}`}>
                        {used.toLocaleString()}<span className="text-sm font-medium text-muted-foreground">/{isUnlimited ? "∞" : limit.toLocaleString()}</span>
                    </p>
                </div>
            </div>

            {!isUnlimited && (
                <div className="space-y-1.5">
                    <div className="h-2 rounded-full bg-muted overflow-hidden w-full relative">
                        <div
                            className={`h-full rounded-full transition-all duration-1000 ${finalFillColor}`}
                            style={{ width: `${percentage}%` }}
                        />
                    </div>
                    {isNearLimit && (
                        <p className="text-[10px] font-semibold text-red-400 animate-pulse text-right w-full">Approaching limit. Upgrade required.</p>
                    )}
                    {isApproachingLimit && (
                        <p className="text-[10px] font-semibold text-amber-400 text-right w-full">
                            80% used —{" "}
                            <a href="/dashboard/billing" className="underline hover:text-amber-300 transition-colors">Upgrade to get more</a>
                        </p>
                    )}
                </div>
            )}
            {isUnlimited && (
                <div className="h-2 rounded-full bg-muted overflow-hidden w-full relative">
                    <div className={`h-full rounded-full w-full opacity-30 ${colors[color].fill}`} />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent w-[200%] animate-[shimmer_2s_infinite]" />
                </div>
            )}
        </div>
    );
}
