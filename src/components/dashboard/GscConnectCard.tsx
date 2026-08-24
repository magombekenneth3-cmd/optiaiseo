import Link from "next/link";
import { Search, Zap, ShieldCheck, ArrowRight } from "lucide-react";

interface Props {
    siteDomain?: string;
}

export function GscConnectCard({ siteDomain }: Props) {
    return (
        <div className="rounded-2xl border border-brand/30 bg-card p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl shadow-black/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-brand/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
            
            <div className="flex items-start gap-4 min-w-0 flex-1 relative z-10">
                <div className="w-12 h-12 rounded-2xl bg-brand/15 border border-brand/25 flex items-center justify-center shrink-0">
                    <Search className="w-6 h-6 text-brand" />
                </div>
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand/10 text-brand text-[11px] font-bold border border-brand/20">
                        <Zap className="w-3 h-3" />
                        Google Integration Required
                    </div>
                    <h2 className="text-lg font-bold text-foreground">
                        Connect Google Search Console {siteDomain ? `for ${siteDomain}` : ""}
                    </h2>
                    <p className="text-xs text-muted-foreground max-w-xl leading-relaxed">
                        Unlock real search queries, impressions, click-through rates, and ranking gaps directly from Google. Connect in 1-click via secure Google OAuth.
                    </p>

                    <div className="pt-2 flex items-center gap-4 text-[11px] text-muted-foreground font-medium flex-wrap">
                        <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Read-only access</span>
                        <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> 100% Secure Google OAuth</span>
                        <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Instant sync</span>
                    </div>
                </div>
            </div>

            <div className="shrink-0 relative z-10 w-full md:w-auto">
                <Link
                    href="/api/auth/signin/google-gsc?callbackUrl=%2Fdashboard%2Fkeywords"
                    className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-brand hover:bg-brand/90 text-brand-foreground text-xs font-bold transition-all shadow-lg shadow-brand/25 active:scale-95"
                >
                    Connect Search Console
                    <ArrowRight className="w-4 h-4" />
                </Link>
            </div>
        </div>
    );
}
