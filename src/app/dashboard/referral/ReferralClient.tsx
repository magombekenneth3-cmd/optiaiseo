"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Gift, Copy, CheckCheck, Users, DollarSign,
    TrendingUp, Clock, ExternalLink, Loader2, RefreshCw,
} from "lucide-react";


interface Commission {
    id: string;
    month: string;
    amountCents: number;
    status: "pending" | "paid";
    createdAt: string;
}

interface ReferralData {
    code: string;
    shareLink: string;
    signups: number;
    conversions: number;
    totalEarnedCents: number;
    pendingCents: number;
    commissions: Commission[];
}


function fmt$(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

function fmtMonth(month: string): string {
    const [y, m] = month.split("-");
    return new Date(Number(y), Number(m) - 1).toLocaleString("default", { month: "long", year: "numeric" });
}


function StatCard({
    label, value, icon: Icon, accent, sub,
}: {
    label: string; value: string | number;
    icon: React.ElementType; accent: string; sub?: string;
}) {
    const colorMap: Record<string, { iconBg: string; iconBorder: string; iconColor: string }> = {
        blue:    { iconBg: "bg-blue-500/10",    iconBorder: "border-blue-500/20",    iconColor: "text-blue-400" },
        emerald: { iconBg: "bg-emerald-500/10", iconBorder: "border-emerald-500/20", iconColor: "text-emerald-400" },
        amber:   { iconBg: "bg-amber-500/10",   iconBorder: "border-amber-500/20",   iconColor: "text-amber-400" },
    };
    const c = colorMap[accent] ?? colorMap.blue;
    return (
        <div className="card-surface p-5">
            <div className={`w-9 h-9 rounded-xl ${c.iconBg} border ${c.iconBorder} flex items-center justify-center mb-3.5`}>
                <Icon className={`w-4 h-4 ${c.iconColor}`} />
            </div>
            <p className="text-2xl font-black tracking-tight tabular-nums text-foreground">
                {value}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                {label}
            </p>
            {sub && <p className="text-[11px] text-muted-foreground/60 mt-1">{sub}</p>}
        </div>
    );
}


export function ReferralClient() {
    const [data, setData] = useState<ReferralData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [activating, setActivating] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/referral");
            if (!res.ok) throw new Error("Failed to load referral data");
            const json = await res.json();
            setData(json.referral ?? null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const activate = async () => {
        setActivating(true);
        try {
            const res = await fetch("/api/referral", { method: "POST" });
            if (!res.ok) throw new Error("Activation failed");
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Activation failed");
        } finally {
            setActivating(false);
        }
    };

    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* clipboard not available */ }
    };


    if (loading) {
        return (
            <div className="flex items-center gap-2.5 text-muted-foreground py-16 justify-center">
                <Loader2 className="w-4.5 h-4.5 animate-spin" />
                <span className="text-sm">Loading referral data…</span>
            </div>
        );
    }


    if (error) {
        return (
            <div className="card-surface p-4 border-rose-500/20 bg-rose-500/5 flex items-center gap-2.5 text-rose-400 text-sm my-10">
                <span className="flex-1">{error}</span>
                <button
                    onClick={load}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold hover:bg-rose-500/20 transition-colors"
                >
                    <RefreshCw className="w-3 h-3" /> Retry
                </button>
            </div>
        );
    }


    if (!data) {
        return (
            <div className="max-w-xl mx-auto py-16 text-center fade-in-up">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-5">
                    <Gift className="w-7 h-7 text-emerald-400" />
                </div>
                <h1 className="text-2xl font-black tracking-tight mb-3 text-foreground">
                    Earn 20% recurring commission
                </h1>
                <p className="text-muted-foreground text-sm mb-8 leading-relaxed max-w-md mx-auto">
                    Refer a friend, colleague, or client to OptiAISEO and earn 20% of their subscription
                    every month they stay — for as long as they&apos;re a customer.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-9">
                    {[
                        { icon: Users, label: "Share your link", desc: "Anyone who signs up through your link is attributed to you automatically" },
                        { icon: TrendingUp, label: "They upgrade", desc: "When they move to a paid plan, you start earning commission" },
                        { icon: DollarSign, label: "You get paid", desc: "20% recurring commission paid monthly via Stripe" },
                    ].map(({ icon: Icon, label, desc }) => (
                        <div key={label} className="card-surface p-4 text-left">
                            <Icon className="w-4 h-4 text-emerald-400 mb-2.5" />
                            <p className="text-xs font-bold text-foreground mb-1.5">{label}</p>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
                        </div>
                    ))}
                </div>
                <button
                    id="activate-referral"
                    onClick={activate}
                    disabled={activating}
                    className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-blue-600 text-white font-bold text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg"
                >
                    {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                    {activating ? "Activating…" : "Activate My Referral Link"}
                </button>
            </div>
        );
    }


    const conversionRate = data.signups > 0
        ? Math.round((data.conversions / data.signups) * 100)
        : 0;

    return (
        <div className="max-w-5xl mx-auto pb-20 fade-in-up">

            <div className="flex items-center gap-3 py-7 border-b border-border mb-7">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Gift className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-foreground">Refer &amp; Earn</h1>
                    <p className="text-[11px] text-muted-foreground">20% recurring commission · paid monthly</p>
                </div>
                <button
                    onClick={load}
                    title="Refresh"
                    className="ml-auto p-2 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="card-surface p-5 border-emerald-500/20 bg-emerald-500/5 mb-6">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                    Your referral link
                </p>
                <div className="flex gap-2 items-center">
                    <div className="flex-1 px-3.5 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground/70 font-mono break-all">
                        {data.shareLink}
                    </div>
                    <button
                        id="copy-referral-link"
                        onClick={() => copy(data.shareLink)}
                        className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${
                            copied
                                ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                                : "bg-card border border-border text-foreground/70 hover:bg-accent"
                        }`}
                    >
                        {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? "Copied!" : "Copy"}
                    </button>
                    <a
                        href={data.shareLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Preview link"
                        className="shrink-0 p-2.5 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2.5">
                    Referral code: <strong className="text-foreground/50 font-mono">{data.code}</strong>
                </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7">
                <StatCard label="Signups" value={data.signups} icon={Users} accent="blue" sub="people who used your link" />
                <StatCard label="Conversions" value={data.conversions} icon={TrendingUp} accent="emerald" sub={`${conversionRate}% conversion rate`} />
                <StatCard label="Total Earned" value={fmt$(data.totalEarnedCents)} icon={DollarSign} accent="emerald" sub="lifetime paid commissions" />
                <StatCard label="Pending" value={fmt$(data.pendingCents)} icon={Clock} accent="amber" sub="will be paid next cycle" />
            </div>

            <div className="card-surface overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Commission History
                    </h3>
                </div>
                <div className="px-5">
                    {data.commissions.length === 0 ? (
                        <p className="text-center py-8 text-sm text-muted-foreground">
                            No commissions yet — share your link to get started.
                        </p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    {["Month", "Amount", "Status", "Date"].map(h => (
                                        <th key={h} className="py-3 px-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.commissions.map((c, i) => (
                                    <tr
                                        key={c.id}
                                        className={i < data.commissions.length - 1 ? "border-b border-border/50" : ""}
                                    >
                                        <td className="py-2.5 px-2 text-xs font-medium text-foreground/70">
                                            {fmtMonth(c.month)}
                                        </td>
                                        <td className="py-2.5 px-2 text-xs font-bold text-emerald-400 tabular-nums">
                                            {fmt$(c.amountCents)}
                                        </td>
                                        <td className="py-2.5 px-2">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                                c.status === "paid"
                                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                            }`}>
                                                {c.status === "paid" ? "Paid" : "Pending"}
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-2 text-[11px] text-muted-foreground">
                                            {new Date(c.createdAt).toLocaleDateString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
