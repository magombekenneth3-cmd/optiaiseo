"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
    detectAndStoreServices,
    fetchCompetitorsForService,
    saveCompetitorForService,
    skipCompetitorSuggestion,
    deleteServiceCompetitor,
    deleteService,
} from "@/app/actions/services";
import { RefreshCw, Plus, Trash2, Lock, Search, Crosshair, ExternalLink, X } from "lucide-react";

type Competitor = { id: string; domain: string };
type Service = { id: string; label: string; name: string; competitors: Competitor[] };

interface Props {
    siteId: string;
    isPaid: boolean;
    initial: Service[];
}

export function CompetitorsPanel({ siteId, isPaid, initial }: Props) {
    const [services, setServices] = useState<Service[]>(initial);
    const [isDetecting, setIsDetecting] = useState(false);
    const [searchingService, setSearchingService] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
    const [addingDomain, setAddingDomain] = useState<string | null>(null);
    const [skippingDomain, setSkippingDomain] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const handleDetectServices = async () => {
        setIsDetecting(true);
        const res = await detectAndStoreServices(siteId);
        if (res.success && res.services.length > 0) {
            setServices(res.services.map(s => ({ ...s, competitors: [] })));
            toast.success(`Found ${res.services.length} service${res.services.length !== 1 ? "s" : ""}.`);
        } else {
            toast.error(res.error ?? "Could not detect services.");
        }
        setIsDetecting(false);
    };

    const handleSearchCompetitors = async (serviceId: string) => {
        if (!isPaid) {
            toast.error("Upgrade to a paid plan to search competitors.");
            return;
        }
        setSearchingService(serviceId);
        setSuggestions(prev => ({ ...prev, [serviceId]: [] }));

        const res = await fetchCompetitorsForService(siteId, serviceId);

        if (res.success && res.suggestions.length > 0) {
            const existing = new Set(
                services.find(s => s.id === serviceId)?.competitors.map(c => c.domain) ?? [],
            );
            const fresh = res.suggestions.filter(d => !existing.has(d));
            if (fresh.length > 0) {
                setSuggestions(prev => ({ ...prev, [serviceId]: fresh }));
            } else {
                toast.info("No new competitors found.");
            }
        } else if (res.error === "upgrade_required") {
            toast.error(res.message ?? "Upgrade required.");
        } else {
            toast.error(res.error ?? "Search failed.");
        }
        setSearchingService(null);
    };

    const handleAddCompetitor = async (serviceId: string, domain: string) => {
        setAddingDomain(domain);
        const res = await saveCompetitorForService(siteId, serviceId, domain);
        if (res.success && res.competitor) {
            setServices(prev =>
                prev.map(s =>
                    s.id === serviceId
                        ? { ...s, competitors: [...s.competitors, res.competitor as Competitor] }
                        : s,
                ),
            );
            setSuggestions(prev => ({
                ...prev,
                [serviceId]: prev[serviceId]?.filter(d => d !== domain) ?? [],
            }));
            toast.success(`${domain} added.`);
        } else {
            toast.error(res.error ?? "Failed to add.");
        }
        setAddingDomain(null);
    };

    const handleSkipSuggestion = async (serviceId: string, domain: string) => {
        setSkippingDomain(domain);
        await skipCompetitorSuggestion(siteId, serviceId, domain);
        setSuggestions(prev => ({
            ...prev,
            [serviceId]: prev[serviceId]?.filter(d => d !== domain) ?? [],
        }));
        setSkippingDomain(null);
    };

    const handleDeleteCompetitor = async (serviceId: string, competitorId: string) => {
        setDeletingId(competitorId);
        const res = await deleteServiceCompetitor(siteId, competitorId);
        if (res.success) {
            setServices(prev =>
                prev.map(s =>
                    s.id === serviceId
                        ? { ...s, competitors: s.competitors.filter(c => c.id !== competitorId) }
                        : s,
                ),
            );
            toast.success("Competitor removed.");
        } else {
            toast.error(res.error ?? "Failed to delete.");
        }
        setDeletingId(null);
    };

    const handleDeleteService = async (serviceId: string) => {
        if (!confirm("Remove this service and all its competitors?")) return;
        const res = await deleteService(serviceId);
        if (res.success) {
            setServices(prev => prev.filter(s => s.id !== serviceId));
            setSuggestions(prev => {
                const next = { ...prev };
                delete next[serviceId];
                return next;
            });
            toast.success("Service removed.");
        } else {
            toast.error(res.error ?? "Failed to delete service.");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 mb-0.5">
                        <Crosshair className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-base font-semibold">Competitors by Service</h2>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        AI detects your services from your homepage, then finds businesses actually ranking on Google for those services.
                        {!isPaid && " Competitor search requires a paid plan."}
                    </p>
                </div>
                <button
                    onClick={handleDetectServices}
                    disabled={isDetecting}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg text-sm font-semibold hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                >
                    {isDetecting
                        ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Detecting…</>
                        : <><Search className="w-3.5 h-3.5" /> Detect services</>
                    }
                </button>
            </div>

            {services.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border rounded-xl text-muted-foreground gap-3">
                    <Crosshair className="w-10 h-10 text-muted-foreground/20" />
                    <div>
                        <p className="font-medium text-sm">No services detected yet</p>
                        <p className="text-xs mt-0.5">
                            Click <strong>Detect services</strong> to automatically identify your services and find businesses competing for the same searches.
                        </p>
                    </div>
                </div>
            )}

            {services.map(service => (
                <div key={service.id} className="p-4 bg-card border border-border rounded-xl space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                            <span className="text-sm font-semibold">{service.label}</span>
                            <span className="ml-2 text-xs text-muted-foreground">— searching for: <em>{service.name}</em></span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => handleSearchCompetitors(service.id)}
                                disabled={searchingService === service.id || !isPaid}
                                title={
                                    !isPaid
                                        ? "Upgrade to search competitors"
                                        : `Find businesses ranking on Google for "${service.name}"`
                                }
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50
                                    ${isPaid
                                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                                        : "bg-muted border-border text-muted-foreground cursor-not-allowed"
                                    }`}
                            >
                                {searchingService === service.id ? (
                                    <><RefreshCw className="w-3 h-3 animate-spin" /> Searching…</>
                                ) : isPaid ? (
                                    <><Search className="w-3 h-3" /> Find competitors</>
                                ) : (
                                    <><Lock className="w-3 h-3" /> Find competitors</>
                                )}
                            </button>
                            <button
                                onClick={() => handleDeleteService(service.id)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors"
                                title="Remove service"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    {service.competitors.length > 0 && (
                        <div className="space-y-1.5">
                            {service.competitors.map(c => (
                                <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-muted rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">{c.domain}</span>
                                        <a
                                            href={`https://${c.domain}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-muted-foreground hover:text-blue-400 transition-colors"
                                            title={`Visit ${c.domain}`}
                                        >
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteCompetitor(service.id, c.id)}
                                        disabled={deletingId === c.id}
                                        className="text-xs text-muted-foreground hover:text-rose-400 disabled:opacity-50 transition-colors"
                                    >
                                        {deletingId === c.id ? "Removing…" : "Remove"}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {(suggestions[service.id]?.length ?? 0) > 0 && (
                        <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg space-y-2">
                            <p className="text-xs font-semibold text-emerald-400">
                                Ranking on Google for &ldquo;{service.name}&rdquo; — add to track:
                            </p>
                            <div className="space-y-1.5">
                                {suggestions[service.id].map(d => (
                                    <div
                                        key={d}
                                        className="flex items-center justify-between px-3 py-2 bg-card border border-border rounded-lg"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{d}</span>
                                            <a
                                                href={`https://${d}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-muted-foreground hover:text-blue-400 transition-colors"
                                                title={`Visit ${d} to confirm`}
                                            >
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                onClick={() => handleAddCompetitor(service.id, d)}
                                                disabled={addingDomain === d}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-md text-xs font-semibold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                                            >
                                                {addingDomain === d
                                                    ? <RefreshCw className="w-3 h-3 animate-spin" />
                                                    : <Plus className="w-3 h-3" />
                                                }
                                                Add
                                            </button>
                                            <button
                                                onClick={() => handleSkipSuggestion(service.id, d)}
                                                disabled={skippingDomain === d}
                                                className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 rounded-md text-xs transition-colors disabled:opacity-50"
                                                title="Not a competitor — don't show again"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {!isPaid && (
                        <p className="text-xs text-muted-foreground border-t border-border pt-2 mt-1">
                            <a href="/dashboard/billing" className="text-emerald-400 hover:underline font-semibold">
                                Upgrade to Pro
                            </a>{" "}
                            to find businesses competing with you on Google for each service.
                        </p>
                    )}
                </div>
            ))}
        </div>
    );
}