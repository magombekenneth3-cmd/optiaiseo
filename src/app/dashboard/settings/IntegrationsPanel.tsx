"use client";

import { useState, useEffect } from "react";
import { Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { IntegrationStatusCard } from "@/components/dashboard/IntegrationStatusCard";
import type { IntegrationStatus } from "@/app/api/integrations/status/route";
import { Ga4ConnectForm } from "@/components/dashboard/Ga4ConnectForm";
import { MozApiTokenCard } from "@/components/dashboard/MozApiTokenCard";
import { ApiAccessCard } from "@/components/dashboard/ApiAccessCard";
import { WordPressPluginPanel } from "./WordPressPluginPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface IntegrationsPanelProps {
    firstSiteId: string;
    firstSiteGa4PropertyId: string | null;
    gscConnected: boolean;
    mozApiToken: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function IntegrationsPanel({
    firstSiteId,
    firstSiteGa4PropertyId,
    gscConnected: initialGscConnected,
    mozApiToken,
}: IntegrationsPanelProps) {
    const [statuses, setStatuses] = useState<IntegrationStatus[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    async function fetchStatuses() {
        try {
            const res = await fetch("/api/integrations/status");
            if (!res.ok) throw new Error("Failed to fetch integration status");
            const data = await res.json();
            setStatuses(data.integrations);
            setError(null);
        } catch {
            setError("Could not load integration status. Using cached state.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    useEffect(() => {
        fetchStatuses();
    }, []);

    function handleRefresh() {
        setRefreshing(true);
        fetchStatuses();
    }

    // Helper to find a status by id, or use server-rendered fallback
    function getStatus(id: string): IntegrationStatus | undefined {
        return statuses?.find((s) => s.id === id);
    }

    const gsc = getStatus("gsc");
    const ga4 = getStatus("ga4");
    const github = getStatus("github");
    const ghost = getStatus("ghost");
    const hashnode = getStatus("hashnode");

    // Count connected
    const connectedCount = statuses?.filter((s) => s.connected).length ?? 0;
    const totalCount = statuses?.length ?? 0;

    return (
        <div className="flex flex-col gap-6">
            {/* Header with refresh + summary */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {connectedCount > 0 ? (
                        <Wifi className="w-4 h-4 text-emerald-400" />
                    ) : (
                        <WifiOff className="w-4 h-4 text-zinc-500" />
                    )}
                    <span className="text-sm text-muted-foreground">
                        {loading ? (
                            "Loading integration status…"
                        ) : (
                            <>
                                <span className="text-emerald-400 font-semibold">{connectedCount}</span>
                                {" of "}
                                <span className="font-medium text-foreground">{totalCount}</span>
                                {" integrations connected"}
                            </>
                        )}
                    </span>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing || loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    Refresh
                </button>
            </div>

            {error && (
                <div className="text-xs text-amber-400 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center gap-3 py-12">
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                    <span className="text-sm text-muted-foreground">Loading integrations…</span>
                </div>
            ) : (
                <>
                    {/* ── Google Search Console ── */}
                    <IntegrationStatusCard
                        id="gsc"
                        name={gsc?.name ?? "Google Search Console"}
                        description={gsc?.description ?? "Live CTR, impressions, position data, keyword opportunities, and experiment tracking."}
                        connected={gsc?.connected ?? initialGscConnected}
                        accountLabel={gsc?.accountLabel}
                        lastSyncAt={gsc?.lastSyncAt}
                        configErrors={gsc?.configErrors ?? []}
                        connectAction="/api/auth/signin/google-gsc?callbackUrl=%2Fdashboard%2Fsettings%3Ftab%3Dintegrations"
                        onDisconnect={async () => {
                            const res = await fetch("/api/settings/disconnect-gsc", { method: "POST" });
                            if (!res.ok) throw new Error("Failed to disconnect");
                        }}
                    />

                    {/* ── Google Analytics 4 ── */}
                    <IntegrationStatusCard
                        id="ga4"
                        name={ga4?.name ?? "Google Analytics 4"}
                        description={ga4?.description ?? "Unified search + analytics data on the Keywords page."}
                        connected={ga4?.connected ?? !!firstSiteGa4PropertyId}
                        accountLabel={ga4?.accountLabel}
                        lastSyncAt={ga4?.lastSyncAt}
                        configErrors={ga4?.configErrors ?? []}
                    >
                        {/* Embed the existing GA4 property selector */}
                        <Ga4ConnectForm siteId={firstSiteId} currentPropertyId={firstSiteGa4PropertyId} />
                    </IntegrationStatusCard>

                    {/* ── GitHub ── */}
                    <IntegrationStatusCard
                        id="github"
                        name={github?.name ?? "GitHub"}
                        description={github?.description ?? "Automated pull requests for content fixes, meta tags, and schema markup."}
                        connected={github?.connected ?? false}
                        accountLabel={github?.accountLabel}
                        lastSyncAt={github?.lastSyncAt}
                        configErrors={github?.configErrors ?? []}
                    />

                    {/* ── Ghost CMS ── */}
                    <IntegrationStatusCard
                        id="ghost"
                        name={ghost?.name ?? "Ghost"}
                        description={ghost?.description ?? "Auto-publish blogs and content to your Ghost CMS via Admin API."}
                        connected={ghost?.connected ?? false}
                        accountLabel={ghost?.accountLabel}
                        lastSyncAt={ghost?.lastSyncAt}
                        configErrors={ghost?.configErrors ?? []}
                    />

                    {/* ── Hashnode ── */}
                    <IntegrationStatusCard
                        id="hashnode"
                        name={hashnode?.name ?? "Hashnode"}
                        description={hashnode?.description ?? "Auto-publish blogs with canonical links to your Hashnode publication."}
                        connected={hashnode?.connected ?? false}
                        accountLabel={hashnode?.accountLabel}
                        lastSyncAt={hashnode?.lastSyncAt}
                        configErrors={hashnode?.configErrors ?? []}
                    />

                    {/* ── Moz (uses existing card but wrapped) ── */}
                    <MozApiTokenCard initialToken={mozApiToken} />

                    {/* ── WordPress ── */}
                    <WordPressPluginPanel siteId={firstSiteId} />

                    {/* ── API Access ── */}
                    <ApiAccessCard />
                </>
            )}
        </div>
    );
}
