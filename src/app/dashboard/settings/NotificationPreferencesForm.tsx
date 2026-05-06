"use client";

import { useState, useTransition } from "react";
import { Bell, BellOff, Loader2, Mail, CheckCircle, Zap, AlertTriangle } from "lucide-react";

interface Props {
    initialEmailDigest?:      boolean;
    initialRankAlerts?:       boolean;
    initialRankThreshold?:    number;
    initialSlackWebhookUrl?:  string;
    siteId?:                  string; // first site ID for webhook config
}

export function NotificationPreferencesForm({
    initialEmailDigest     = true,
    initialRankAlerts      = true,
    initialRankThreshold   = 3,
    initialSlackWebhookUrl = "",
    siteId,
}: Props) {
    const [emailDigest,     setEmailDigest]     = useState(initialEmailDigest);
    const [rankAlerts,      setRankAlerts]      = useState(initialRankAlerts);
    const [threshold,       setThreshold]       = useState(initialRankThreshold);
    const [slackUrl,        setSlackUrl]        = useState(initialSlackWebhookUrl);
    const [saved,           setSaved]           = useState(false);
    const [error,           setError]           = useState("");
    const [isPending,       startTransition]    = useTransition();

    const save = async (patch: Record<string, unknown>, webhookPatch?: { slackWebhookUrl?: string }) => {
        setSaved(false);
        setError("");
        startTransition(async () => {
            try {
                const prefRes = await fetch("/api/settings/preferences", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                });
                if (!prefRes.ok) throw new Error(await prefRes.text());

                if (webhookPatch && siteId) {
                    const whRes = await fetch(`/api/sites/${siteId}/webhooks`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(webhookPatch),
                    });
                    if (!whRes.ok) throw new Error(await whRes.text());
                }

                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
            } catch (err: unknown) {
                setError((err as Error)?.message ?? "Failed to save. Please try again.");
            }
        });
    };

    const handleEmailToggle = () => {
        const next = !emailDigest;
        setEmailDigest(next);
        save({ emailDigest: next });
    };

    const handleRankAlertToggle = () => {
        const next = !rankAlerts;
        setRankAlerts(next);
        save({ rankAlerts: next });
    };

    const handleThresholdChange = (val: number) => {
        setThreshold(val);
        save({ rankAlertThreshold: val });
    };

    const handleSlackSave = () => {
        save({ rankAlerts }, { slackWebhookUrl: slackUrl.trim() || undefined });
    };

    return (
        <div className="space-y-4">
            {/* Email Digest */}
            <div className="card-surface p-6">
                <div className="flex items-start gap-4 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-accent border border-border flex items-center justify-center shrink-0">
                        <Bell className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold mb-1">Weekly Email Digest</h2>
                        <p className="text-sm text-muted-foreground max-w-md">
                            Personalised weekly report: ranking wins, AI citations detected, and top 3 priority fixes.
                            Pro/Agency plans receive weekly; Free plans receive monthly.
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card">
                    <div className="flex items-center gap-3">
                        {emailDigest
                            ? <Mail    className="w-4 h-4 text-emerald-400 shrink-0" />
                            : <BellOff className="w-4 h-4 text-muted-foreground shrink-0" />
                        }
                        <div>
                            <p className="text-sm font-semibold">
                                {emailDigest ? "Weekly Digest — Enabled" : "Weekly Digest — Disabled"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {emailDigest
                                    ? "You'll receive ranking wins, AI citations, and priority fixes every week."
                                    : "You will not receive weekly digest emails."}
                            </p>
                        </div>
                    </div>
                    <button
                        id="email-digest-toggle"
                        role="switch"
                        aria-checked={emailDigest}
                        onClick={handleEmailToggle}
                        disabled={isPending}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 ${
                            emailDigest ? "bg-emerald-500" : "bg-zinc-700"
                        } disabled:opacity-60`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            emailDigest ? "translate-x-6" : "translate-x-1"
                        }`} />
                    </button>
                </div>
            </div>

            {/* Rank Alert Settings */}
            <div className="card-surface p-6">
                <div className="flex items-start gap-4 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-5 h-5 text-rose-400" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold mb-1">Rank Drop Alerts</h2>
                        <p className="text-sm text-muted-foreground max-w-md">
                            Get notified via Slack/Zapier the moment a tracked keyword drops more than your threshold.
                            Only available on Pro and Agency plans.
                        </p>
                    </div>
                </div>

                {/* Enable toggle */}
                <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card mb-4">
                    <div className="flex items-center gap-3">
                        <Zap className={`w-4 h-4 shrink-0 ${rankAlerts ? "text-rose-400" : "text-muted-foreground"}`} />
                        <p className="text-sm font-semibold">
                            {rankAlerts ? "Rank Drop Alerts — On" : "Rank Drop Alerts — Off"}
                        </p>
                    </div>
                    <button
                        id="rank-alert-toggle"
                        role="switch"
                        aria-checked={rankAlerts}
                        onClick={handleRankAlertToggle}
                        disabled={isPending}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            rankAlerts ? "bg-rose-500" : "bg-zinc-700"
                        } disabled:opacity-60`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            rankAlerts ? "translate-x-6" : "translate-x-1"
                        }`} />
                    </button>
                </div>

                {/* Threshold slider */}
                {rankAlerts && (
                    <div className="mb-4">
                        <label className="text-sm font-medium mb-2 block">
                            Alert threshold: <span className="text-rose-400 font-bold">{threshold} positions</span>
                        </label>
                        <input
                            type="range"
                            min={1}
                            max={10}
                            step={1}
                            value={threshold}
                            onChange={(e) => setThreshold(Number(e.target.value))}
                            onMouseUp={(e) => handleThresholdChange(Number((e.target as HTMLInputElement).value))}
                            onTouchEnd={(e) => handleThresholdChange(Number((e.target as HTMLInputElement).value))}
                            className="w-full accent-rose-500"
                            aria-label="Rank alert threshold in positions"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>1 position</span>
                            <span>10 positions</span>
                        </div>
                    </div>
                )}

                {/* Slack URL */}
                {rankAlerts && siteId && (
                    <div className="space-y-2">
                        <label htmlFor="slack-webhook-url" className="text-sm font-medium">
                            Slack Incoming Webhook URL
                        </label>
                        <div className="flex gap-2">
                            <input
                                id="slack-webhook-url"
                                type="url"
                                value={slackUrl}
                                onChange={(e) => setSlackUrl(e.target.value)}
                                placeholder="https://hooks.slack.com/services/..."
                                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                            />
                            <button
                                onClick={handleSlackSave}
                                disabled={isPending}
                                className="px-4 py-2 text-sm font-semibold bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors disabled:opacity-50"
                            >
                                Save
                            </button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                                Create a Slack app
                            </a>{" "}
                            and paste the incoming webhook URL here.
                        </p>
                    </div>
                )}
            </div>

            {/* Status */}
            {isPending && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </p>
            )}
            {saved && !isPending && (
                <p className="flex items-center gap-2 text-xs text-emerald-400">
                    <CheckCircle className="w-3 h-3" /> Saved.
                </p>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}

            <p className="text-xs text-muted-foreground/60">
                You can also unsubscribe via the one-click link at the bottom of any digest email.
            </p>
        </div>
    );
}
