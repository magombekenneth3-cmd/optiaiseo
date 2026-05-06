"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, TrendingUp, TrendingDown, Info, Loader2, Sparkles, ChevronRight } from "lucide-react";
import { getSiteAlerts } from "@/app/actions/alerts";
import { PredictiveAlert } from "@/lib/alerts/engine";

export function PredictiveAlertsSection({ siteId }: { siteId: string }) {
    const [alerts, setAlerts] = useState<PredictiveAlert[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchAlerts() {
            const res = await getSiteAlerts(siteId);
            if (res.success && res.alerts) {
                setAlerts(res.alerts);
            }
            setLoading(false);
        }
        fetchAlerts();
    }, [siteId]);

    if (loading) {
        return (
            <div className="card-surface p-6 border-border flex items-center justify-center min-h-[150px]">
                <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                    <p className="text-sm text-muted-foreground">Analyzing site health & competitor shifts...</p>
                </div>
            </div>
        );
    }

    if (alerts.length === 0) return null;

    return (
        <div className="card-surface p-6 border-emerald-500/20 bg-emerald-500/5 overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                <Sparkles className="w-12 h-12 text-emerald-400" />
            </div>

            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <Sparkles className="w-5 h-5" />
                </div>
                God Level Predictive Alerts
            </h2>

            <div className="space-y-4">
                {alerts.map((alert) => (
                    <div key={alert.id} className="p-4 rounded-xl bg-card border border-border hover:border-emerald-500/30 transition-all group">
                        <div className="flex gap-4">
                            <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${alert.severity === "CRITICAL" ? "bg-red-500/20 text-red-400" :
                                alert.severity === "HIGH" ? "bg-amber-500/20 text-amber-400" :
                                    alert.type === "KG_PROPAGATION" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" :
                                        "bg-blue-500/20 text-blue-400"
                                }`}>
                                {alert.type === "RANKING_DROP" && <TrendingDown className="w-5 h-5" />}
                                {alert.type === "COMPETITOR_JUMP" && <TrendingUp className="w-5 h-5" />}
                                {alert.type === "SNIPPET_LOSS" && <AlertTriangle className="w-5 h-5" />}
                                {alert.type === "AEO_CITATION_LOSS" && <Sparkles className="w-5 h-5" />}
                                {alert.type === "KG_PROPAGATION" && <div className="text-xl">🕸️</div>}
                            </div>

                            <div className="flex-1">
                                <div className="flex items-center justify-between gap-4 mb-1">
                                    <h3 className="font-bold text-foreground">{alert.title}</h3>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${alert.severity === "CRITICAL" ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                                        alert.severity === "HIGH" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                                            "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                        }`}>
                                        {alert.severity}
                                    </span>
                                </div>
                                <p className="text-sm text-muted-foreground mb-3">{alert.description}</p>

                                <div className="p-3 rounded-lg bg-muted border border-border space-y-2">
                                    <div className="flex gap-2">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest shrink-0 mt-0.5">Impact</span>
                                        <p className="text-xs text-zinc-300 leading-relaxed font-medium">{alert.impact}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest shrink-0 mt-0.5">Action</span>
                                        <p className="text-xs text-emerald-400/90 leading-relaxed font-medium flex items-center gap-1">
                                            {alert.action}
                                            <ChevronRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-6 flex justify-end text-[10px] text-muted-foreground font-medium">
                Autonomous monitoring active since {new Date().toLocaleDateString()}
            </div>
        </div>
    );
}
