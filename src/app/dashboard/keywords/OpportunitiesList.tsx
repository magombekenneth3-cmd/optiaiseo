"use client";

import { useState } from "react";
import { AlertTriangle, TrendingUp, Sparkles, ArrowRight } from "lucide-react";
import { KeywordDetailDrawer, type DrawerKeyword } from "./KeywordDetailDrawer";

const CTR_BENCH: Record<number, number> = {
    1: 27.6, 2: 15.8, 3: 11.0, 4: 8.4, 5: 6.3,
    6: 4.9, 7: 3.9, 8: 3.3, 9: 2.7, 10: 2.4,
};

function benchCtr(pos: number) {
    if (pos <= 10) return CTR_BENCH[pos] ?? 2.4;
    if (pos <= 20) return 1.5;
    return 0.5;
}

interface GscKeyword {
    keyword: string;
    position: number;
    clicks: number;
    impressions: number;
    ctr: number;
    url: string;
    intent?: string | null;
    difficulty?: number | null;
    positionHistory?: { date: string; position: number }[];
}

interface ActionItem {
    type: "fix_ctr" | "push_page1" | "create_content";
    kw: GscKeyword;
    detail: string;
    impactLabel: string;
    est: number;
}

const CFG = {
    fix_ctr: { icon: AlertTriangle, label: "Fix CTR", impact: "High Impact", color: "#f85149", cta: "Review page" },
    push_page1: { icon: TrendingUp, label: "Push to Page 1", impact: "High Impact", color: "#d29922", cta: "Improve page" },
    create_content: { icon: Sparkles, label: "Create Supporting Content", impact: "Medium Impact", color: "#388bfd", cta: "Create content" },
} as const;

function computeActions(keywords: GscKeyword[]): ActionItem[] {
    const actions: ActionItem[] = [];

    const ctrGaps = keywords
        .filter(kw => kw.position <= 10 && kw.ctr < benchCtr(kw.position) * 0.6 && kw.impressions > 0)
        .sort((a, b) => {
            const iA = Math.round(a.impressions * benchCtr(a.position) / 100) - a.clicks;
            const iB = Math.round(b.impressions * benchCtr(b.position) / 100) - b.clicks;
            return iB - iA;
        })
        .slice(0, 2);

    for (const kw of ctrGaps) {
        const b = benchCtr(kw.position);
        const est = Math.max(1, Math.round(kw.impressions * b / 100 - kw.clicks));
        actions.push({
            type: "fix_ctr", kw,
            detail: `${kw.keyword} · Position #${kw.position} · ${kw.ctr}% CTR vs ${b}% benchmark`,
            impactLabel: `Est. +${est} clicks/mo`, est,
        });
    }

    const p2 = keywords
        .filter(kw => kw.position >= 11 && kw.position <= 20)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 2);

    for (const kw of p2) {
        const est = Math.max(1, Math.round(kw.impressions * 0.278 - kw.clicks));
        actions.push({
            type: "push_page1", kw,
            detail: `${kw.keyword} · Position #${kw.position} · ${kw.impressions.toLocaleString()} impressions`,
            impactLabel: `Est. +${est} clicks/mo`, est,
        });
    }

    const deep = keywords
        .filter(kw => kw.position > 20 && kw.impressions > 30)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 2);

    for (const kw of deep) {
        const est = Math.max(1, Math.round(kw.impressions * 0.15));
        actions.push({
            type: "create_content", kw,
            detail: `${kw.keyword} · Position #${kw.position} · No relevant page`,
            impactLabel: `Est. +${est} clicks/mo`, est,
        });
    }

    return actions.sort((a, b) => b.est - a.est).slice(0, 3);
}

export function PriorityActions({ keywords, siteId }: { keywords: GscKeyword[]; siteId: string }) {
    const [drawerKw, setDrawerKw] = useState<DrawerKeyword | null>(null);
    const actions = computeActions(keywords);

    if (actions.length === 0) return (
        <div className="rounded-xl border border-[#21262d] bg-[#0d1117] p-6 text-center">
            <p className="text-[13px] text-[#6e7681]">No priority actions found right now.</p>
        </div>
    );

    return (
        <>
            <div className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden h-full">
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#161b22]">
                    <h2 className="text-[14px] font-semibold text-[#e6edf3]">Priority Actions</h2>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#d29922]/10 text-[#d29922] border border-[#d29922]/20">
                        {actions.length} actions need your attention
                    </span>
                </div>
                <div className="divide-y divide-[#161b22]">
                    {actions.map((a, i) => {
                        const c = CFG[a.type];
                        const Icon = c.icon;
                        return (
                            <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#0f1318] transition-colors">
                                <div
                                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                                    style={{ background: `${c.color}12` }}
                                >
                                    <Icon className="w-3.5 h-3.5" style={{ color: c.color }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span className="text-[13px] font-semibold text-[#e6edf3]">{c.label}</span>
                                        <span
                                            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                            style={{ color: c.color, background: `${c.color}15` }}
                                        >
                                            {c.impact}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-[#6e7681] truncate">{a.detail}</p>
                                </div>
                                <span className="hidden sm:block shrink-0 text-[11px] font-medium text-[#2ea043]">
                                    {a.impactLabel}
                                </span>
                                <button
                                    onClick={() => setDrawerKw(a.kw)}
                                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors"
                                    style={{ color: c.color, borderColor: `${c.color}30`, background: `${c.color}08` }}
                                >
                                    {c.cta}<ArrowRight className="w-3 h-3" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
            {drawerKw && (
                <KeywordDetailDrawer keyword={drawerKw} siteId={siteId} onClose={() => setDrawerKw(null)} />
            )}
        </>
    );
}
