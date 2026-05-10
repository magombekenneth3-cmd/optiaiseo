"use client";

/**
 * Referral programme dashboard.
 *
 * Shows:
 *  - Unique referral link with one-click copy
 *  - Lifetime stats: signups, conversions, total earned, pending
 *  - Commission history table (month, amount, status)
 *
 * All data is fetched from /api/referral.
 */

import { useState, useEffect, useCallback } from "react";
import {
    Gift, Copy, CheckCheck, Users, DollarSign,
    TrendingUp, Clock, ExternalLink, Loader2, RefreshCw,
} from "lucide-react";


interface Commission {
    id: string;
    month: string;         // e.g. "2026-04"
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
    label, value, icon: Icon, accent, iconColor, sub,
}: {
    label: string; value: string | number;
    icon: React.ElementType; accent: string; iconColor: string; sub?: string;
}) {
    return (
        <div style={{
            padding: "20px",
            borderRadius: 14,
            background: "rgba(255,255,255,.02)",
            border: "1px solid rgba(255,255,255,.07)",
        }}>
            <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: accent, border: `1px solid ${iconColor}25`,
                display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
            }}>
                <Icon size={16} style={{ color: iconColor }} />
            </div>
            <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "rgba(255,255,255,.9)", letterSpacing: "-.03em", fontVariantNumeric: "tabular-nums" }}>
                {value}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.35)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                {label}
            </p>
            {sub && <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,.2)" }}>{sub}</p>}
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
        } catch {
            // fallback — silently ignore if clipboard not available
        }
    };


    if (loading) {
        return (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "rgba(255,255,255,.25)", padding: "60px 0", justifyContent: "center" }}>
                <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
                Loading referral data…
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }


    if (error) {
        return (
            <div style={{ padding: "16px 20px", borderRadius: 12, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", color: "#f87171", fontSize: 13, display: "flex", alignItems: "center", gap: 10, margin: "40px 0" }}>
                {error}
                <button onClick={load} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 7, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", color: "#f87171", fontSize: 11, cursor: "pointer" }}>
                    <RefreshCw size={11} /> Retry
                </button>
            </div>
        );
    }


    if (!data) {
        return (
            <div style={{ maxWidth: 580, margin: "60px auto", textAlign: "center" }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                    <Gift size={24} style={{ color: "#34d399" }} />
                </div>
                <h1 style={{ margin: "0 0 12px", fontSize: 26, fontWeight: 800, color: "rgba(255,255,255,.9)", letterSpacing: "-.03em" }}>
                    Earn 20% recurring commission
                </h1>
                <p style={{ margin: "0 0 32px", fontSize: 15, color: "rgba(255,255,255,.4)", lineHeight: 1.7 }}>
                    Refer a friend, colleague, or client to OptiAISEO and earn 20% of their subscription
                    every month they stay — for as long as they're a customer.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 36 }}>
                    {[
                        { icon: Users, label: "Share your link", desc: "Anyone who signs up through your link is attributed to you automatically" },
                        { icon: TrendingUp, label: "They upgrade", desc: "When they move to a paid plan, you start earning commission" },
                        { icon: DollarSign, label: "You get paid", desc: "20% recurring commission paid monthly via Stripe" },
                    ].map(({ icon: Icon, label, desc }) => (
                        <div key={label} style={{ padding: "16px", borderRadius: 12, background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)", textAlign: "left" }}>
                            <Icon size={16} style={{ color: "#34d399", marginBottom: 10 }} />
                            <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,.8)" }}>{label}</p>
                            <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,.3)", lineHeight: 1.6 }}>{desc}</p>
                        </div>
                    ))}
                </div>
                <button
                    id="activate-referral"
                    onClick={activate}
                    disabled={activating}
                    style={{
                        padding: "13px 32px", borderRadius: 12,
                        background: "linear-gradient(135deg, #10b981, #3b82f6)",
                        border: "none", color: "#fff", fontSize: 15, fontWeight: 700,
                        cursor: activating ? "not-allowed" : "pointer",
                        opacity: activating ? .7 : 1, transition: "all .15s",
                        display: "inline-flex", alignItems: "center", gap: 8,
                    }}
                >
                    {activating ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Gift size={16} />}
                    {activating ? "Activating…" : "Activate My Referral Link"}
                </button>
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }


    const conversionRate = data.signups > 0
        ? Math.round((data.conversions / data.signups) * 100)
        : 0;

    return (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0 80px" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "28px 0 24px", borderBottom: "1px solid rgba(255,255,255,.05)", marginBottom: 28 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Gift size={16} style={{ color: "#34d399" }} />
                </div>
                <div>
                    <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "rgba(255,255,255,.9)", letterSpacing: "-.02em" }}>Refer &amp; Earn</h1>
                    <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,.3)" }}>20% recurring commission · paid monthly</p>
                </div>
                <button
                    onClick={load}
                    title="Refresh"
                    style={{ marginLeft: "auto", padding: "7px 10px", borderRadius: 9, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.4)", cursor: "pointer" }}
                >
                    <RefreshCw size={13} />
                </button>
            </div>

            {/* Referral link box */}
            <div style={{ padding: "20px", borderRadius: 14, background: "rgba(16,185,129,.05)", border: "1px solid rgba(16,185,129,.15)", marginBottom: 24 }}>
                <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "rgba(255,255,255,.35)" }}>
                    Your referral link
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, padding: "10px 14px", borderRadius: 9, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", fontSize: 13, color: "rgba(255,255,255,.7)", fontFamily: "monospace", wordBreak: "break-all" }}>
                        {data.shareLink}
                    </div>
                    <button
                        id="copy-referral-link"
                        onClick={() => copy(data.shareLink)}
                        style={{
                            flexShrink: 0, display: "flex", alignItems: "center", gap: 6,
                            padding: "10px 16px", borderRadius: 9,
                            background: copied ? "rgba(16,185,129,.15)" : "rgba(255,255,255,.06)",
                            border: copied ? "1px solid rgba(16,185,129,.3)" : "1px solid rgba(255,255,255,.1)",
                            color: copied ? "#34d399" : "rgba(255,255,255,.7)",
                            fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all .2s",
                        }}
                    >
                        {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
                        {copied ? "Copied!" : "Copy"}
                    </button>
                    <a
                        href={data.shareLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Preview link"
                        style={{ flexShrink: 0, padding: "10px", borderRadius: 9, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.4)", display: "flex", alignItems: "center" }}
                    >
                        <ExternalLink size={13} />
                    </a>
                </div>
                <p style={{ margin: "10px 0 0", fontSize: 11, color: "rgba(255,255,255,.25)" }}>
                    Referral code: <strong style={{ color: "rgba(255,255,255,.5)", fontFamily: "monospace" }}>{data.code}</strong>
                </p>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 28 }}>
                <StatCard label="Signups" value={data.signups} icon={Users} accent="rgba(59,130,246,.1)" iconColor="#60a5fa" sub="people who used your link" />
                <StatCard label="Conversions" value={data.conversions} icon={TrendingUp} accent="rgba(16,185,129,.1)" iconColor="#34d399" sub={`${conversionRate}% conversion rate`} />
                <StatCard label="Total Earned" value={fmt$(data.totalEarnedCents)} icon={DollarSign} accent="rgba(16,185,129,.1)" iconColor="#34d399" sub="lifetime paid commissions" />
                <StatCard label="Pending" value={fmt$(data.pendingCents)} icon={Clock} accent="rgba(251,191,36,.08)" iconColor="#fbbf24" sub="will be paid next cycle" />
            </div>

            {/* Commission history */}
            <div style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)", overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                    <h3 style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(255,255,255,.4)" }}>
                        Commission History
                    </h3>
                </div>
                <div style={{ padding: "0 18px" }}>
                    {data.commissions.length === 0 ? (
                        <p style={{ textAlign: "center", padding: "32px 0", fontSize: 13, color: "rgba(255,255,255,.2)", margin: 0 }}>
                            No commissions yet — share your link to get started.
                        </p>
                    ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                                    {["Month", "Amount", "Status", "Date"].map(h => (
                                        <th key={h} style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(255,255,255,.25)" }}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.commissions.map((c, i) => (
                                    <tr
                                        key={c.id}
                                        style={{ borderBottom: i < data.commissions.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none" }}
                                    >
                                        <td style={{ padding: "10px 8px", fontSize: 12, color: "rgba(255,255,255,.7)", fontWeight: 500 }}>
                                            {fmtMonth(c.month)}
                                        </td>
                                        <td style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>
                                            {fmt$(c.amountCents)}
                                        </td>
                                        <td style={{ padding: "10px 8px" }}>
                                            <span style={{
                                                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5,
                                                background: c.status === "paid" ? "rgba(16,185,129,.1)" : "rgba(251,191,36,.08)",
                                                color: c.status === "paid" ? "#34d399" : "#fbbf24",
                                                border: `1px solid ${c.status === "paid" ? "rgba(16,185,129,.2)" : "rgba(251,191,36,.15)"}`,
                                            }}>
                                                {c.status === "paid" ? "Paid" : "Pending"}
                                            </span>
                                        </td>
                                        <td style={{ padding: "10px 8px", fontSize: 11, color: "rgba(255,255,255,.25)" }}>
                                            {new Date(c.createdAt).toLocaleDateString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
