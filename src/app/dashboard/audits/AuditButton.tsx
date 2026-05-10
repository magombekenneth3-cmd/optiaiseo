/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { runAudit } from "@/app/actions/audit";
import { showActionError } from "@/lib/ui/action-errors";
import { Loader2, ScanLine, CheckCircle2, AlertCircle, Globe, Home, ChevronDown } from "lucide-react";

type AuditMode = "homepage" | "full";

const TIER_PAGE_LIMITS: Record<string, number> = {
    FREE: 5,
    PRO: 25,
    AGENCY: 50,
    ENTERPRISE: 100,
};

function getTierLabel(tier?: string) {
    const t = (tier ?? "FREE").toUpperCase();
    const pages = TIER_PAGE_LIMITS[t] ?? 5;
    return { pages, tier: t };
}

function AuditModeSelector({
    onSelect,
    tier,
    disabled,
}: {
    onSelect: (mode: AuditMode) => void;
    tier?: string;
    disabled?: boolean;
}) {
    const { pages, tier: resolvedTier } = getTierLabel(tier);
    const isFree = resolvedTier === "FREE";

    return (
        <div className="flex flex-col gap-2 p-3 min-w-[230px]">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">
                Choose Audit Scope
            </p>

            {/* Homepage Only */}
            <button
                onClick={() => onSelect("homepage")}
                disabled={disabled}
                className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-muted border border-transparent hover:border-border transition-all text-left group"
            >
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-blue-500/20 transition-colors">
                    <Home className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                    <p className="text-sm font-medium text-white">Homepage Only</p>
                    <p className="text-xs text-muted-foreground">Fast scan of your main page</p>
                </div>
            </button>

            {/* Full Site Audit */}
            <button
                onClick={() => onSelect("full")}
                disabled={disabled}
                className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-muted border border-transparent hover:border-border transition-all text-left group"
            >
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-emerald-500/20 transition-colors">
                    <Globe className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">Full Site Audit</p>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                            isFree
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        }`}>
                            up to {pages} pages
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {isFree
                            ? "Crawls up to 5 pages — upgrade for more"
                            : `Deep scan across up to ${pages} pages`}
                    </p>
                </div>
            </button>

            {isFree && (
                <div className="mt-1 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400/80">
                    🔓 Upgrade to Pro for up to 25 pages, Agency for 50
                </div>
            )}
        </div>
    );
}

// Renders directly into document.body — completely escapes any CSS stacking
// context (transform, overflow, contain, will-change) from parent elements.

function ModalPortal({
    onClose,
    children,
}: {
    onClose: () => void;
    children: React.ReactNode;
}) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        // Lock body scroll while open
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = "";
        };
    }, []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    if (!mounted) return null;

    return createPortal(
        <div
            style={{ position: "fixed", inset: 0, zIndex: 9999 }}
            aria-modal="true"
            role="dialog"
        >
            {/* Backdrop */}
            <div
                style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)" }}
                onClick={onClose}
            />
            {/* Centered content */}
            <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", pointerEvents: "none" }}>
                <div style={{ pointerEvents: "auto" }}>
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}

export function AuditButton({
    siteId,
    sites,
    userTier,
}: {
    siteId?: string;
    sites?: any[];
    userTier?: string;
}) {
    const router = useRouter();
    const [isPending, setIsPending] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [pendingSiteId, setPendingSiteId] = useState<string | null>(null);

    const handleAudit = async (targetSiteId: string, mode: AuditMode) => {
        setIsPending(true);
        setIsDropdownOpen(false);
        setPendingSiteId(null);

        const loadingToastId = toast.loading(
            <div className="flex flex-col gap-0.5">
                <span className="font-semibold">
                    {mode === "homepage" ? "Homepage Audit in Progress" : "Full Site Audit Queued"}
                </span>
                <span className="text-xs opacity-70">
                    {mode === "homepage"
                        ? "Scanning homepage — meta tags, performance, links…"
                        : "Discovering pages and queueing background scan…"}
                </span>
            </div>
        );

        try {
            const res = await runAudit(targetSiteId, mode);
            toast.dismiss(loadingToastId);

            if (res.success && (res as any).audit?.id) {
                const auditId = (res as any).audit.id;
                // Refresh immediately so AuditPoller receives the new PENDING audit
                // and starts polling without requiring a manual page refresh.
                router.refresh();
                toast.success(
                    <div className="flex flex-col gap-1">
                        <span className="font-semibold flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            {mode === "homepage" ? "Audit Queued!" : "Full Site Audit Queued!"}
                        </span>
                        <span className="text-xs opacity-80">
                            {mode === "full"
                                ? "Pages are being discovered and audited in the background."
                                : "Your homepage audit is running in the background."}
                        </span>
                        <Link
                            href={`/dashboard/audits/${auditId}`}
                            className="text-xs text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
                        >
                            View report →
                        </Link>
                    </div>,
                    { duration: 8000 }
                );
            } else {
                showActionError(res as { success: false; error?: string; code?: string });
            }
        } catch (e: unknown) {
            toast.dismiss(loadingToastId);
            toast.error(
                <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">Unexpected Error</span>
                    <span className="text-xs opacity-80">{(e as Error)?.message || "Please try again."}</span>
                </div>
            );
        } finally {
            setIsPending(false);
        }
    };

    const modalContent = (
        <div className="w-full max-w-xs rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <AuditModeSelector
                tier={userTier}
                onSelect={(mode) => {
                    setIsDropdownOpen(false);
                    const target = siteId ?? pendingSiteId;
                    if (target) handleAudit(target, mode);
                }}
                disabled={isPending}
            />
        </div>
    );

    const multiSiteSelectionContent = (
        <div className="w-full max-w-xs rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-2 border-b border-border bg-muted/50">
                <p className="text-xs font-medium text-muted-foreground text-center">Select Site to Audit</p>
            </div>
            <ul className="max-h-60 overflow-y-auto p-1">
                {(sites ?? []).map((site: any) => (
                    <li key={site.id}>
                        <button
                            onClick={() => setPendingSiteId(site.id)}
                            className="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-muted rounded-lg transition-colors flex items-center justify-between group"
                        >
                            <span className="truncate">{site.domain}</span>
                            <ChevronDown className="w-3.5 h-3.5 -rotate-90 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400" />
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );

    if (siteId) {
        return (
            <>
                <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    disabled={isPending}
                    aria-expanded={isDropdownOpen}
                    aria-haspopup="menu"
                    className="inline-flex items-center gap-2 bg-primary hover:bg-emerald-400 text-primary-foreground px-5 py-2.5 rounded-xl font-medium transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_25px_rgba(16,185,129,0.35)] active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                    aria-label="Run a manual SEO audit"
                >
                    {isPending ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            <span className="sr-only">Scanning…</span>
                            Scanning…
                        </>
                    ) : (
                        <>
                            <ScanLine className="w-4 h-4" aria-hidden="true" />
                            Run Audit
                            <ChevronDown className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
                        </>
                    )}
                </button>

                {isDropdownOpen && !isPending && (
                    <ModalPortal onClose={() => setIsDropdownOpen(false)}>
                        {modalContent}
                    </ModalPortal>
                )}
            </>
        );
    }

    return (
        <>
            <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                disabled={isPending || !sites || sites.length === 0}
                aria-expanded={isDropdownOpen}
                aria-haspopup="menu"
                className="inline-flex items-center gap-2 bg-primary hover:bg-emerald-400 text-primary-foreground px-5 py-2.5 rounded-xl font-medium transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_25px_rgba(16,185,129,0.35)] active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                aria-label="Run a manual SEO audit"
            >
                {isPending ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        <span className="sr-only">Scanning…</span>
                        Scanning…
                    </>
                ) : (
                    <>
                        <ScanLine className="w-4 h-4" aria-hidden="true" />
                        Run Audit
                        <ChevronDown className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
                    </>
                )}
            </button>

            {isDropdownOpen && sites && sites.length > 0 && (
                <ModalPortal onClose={() => { setIsDropdownOpen(false); setPendingSiteId(null); }}>
                    {pendingSiteId ? modalContent : multiSiteSelectionContent}
                </ModalPortal>
            )}
        </>
    );
}
