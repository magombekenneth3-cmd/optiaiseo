"use client";

import { useState } from "react";
import { Layers, CheckCircle2, XCircle, Sparkles, FileText } from "lucide-react";
import { discoverServiceEntities, generateEntityPageForSite, type ServiceEntity } from "@/app/actions/entityDiscovery";
import toast from "react-hot-toast";

interface EntityPanelProps {
    siteId: string;
}

export function EntityPanel({ siteId }: EntityPanelProps) {
    const [entities, setEntities] = useState<ServiceEntity[]>([]);
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState<string | null>(null);

    const handleDiscover = async () => {
        setLoading(true);
        try {
            const res = await discoverServiceEntities(siteId);
            if (res.success && res.entities) {
                setEntities(res.entities);
                toast.success(`Found ${res.entities.filter(e => e.isUnique).length} unique service entities`);
            } else {
                toast.error(res.error ?? "Discovery failed. Make sure you've added core services.");
            }
        } finally {
            setLoading(false);
        }
    };

    const handleGeneratePage = async (entity: ServiceEntity) => {
        setGenerating(entity.suggestedSlug);
        try {
            const res = await generateEntityPageForSite(siteId, entity);
            if (res.success) {
                toast.success(`Service page for "${entity.fullName}" created in Blogs`);
            } else {
                toast.error(res.error ?? "Page generation failed");
            }
        } finally {
            setGenerating(null);
        }
    };

    const uniqueEntities = entities.filter(e => e.isUnique);
    const clusterEntities = entities.filter(e => !e.isUnique);

    return (
        <div className="card-surface p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-semibold flex items-center gap-2">
                        <Layers className="w-4 h-4 text-purple-400" />
                        Service Entities
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        One dedicated page per entity — how AI engines understand your offering.
                    </p>
                </div>
                <button
                    id="entity-discover-btn"
                    onClick={handleDiscover}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 text-xs rounded-lg transition-colors disabled:opacity-50 border border-purple-500/20"
                >
                    <Sparkles className="w-3.5 h-3.5" />
                    {loading ? "Discovering…" : "Discover Entities"}
                </button>
            </div>

            {/* Empty state */}
            {entities.length === 0 && (
                <div className="text-center py-6 border border-dashed border-white/10 rounded-xl">
                    <Layers className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">
                        Click &ldquo;Discover Entities&rdquo; to identify unique service entities<br />
                        from your core services list. Each gets its own dedicated page.
                    </p>
                </div>
            )}

            {/* Unique entities — each gets its own page */}
            {uniqueEntities.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        Unique Entities — each gets its own page
                    </p>
                    {uniqueEntities.map((entity) => (
                        <div
                            key={entity.suggestedSlug}
                            id={`entity-${entity.suggestedSlug}`}
                            className="flex items-center justify-between p-3 bg-white/3 rounded-lg border border-white/5 hover:border-white/10 transition-colors"
                        >
                            <div className="flex items-center gap-2.5 min-w-0">
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">{entity.fullName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        <span className="capitalize">{entity.intentType}</span>
                                        {" · "}
                                        <span className="font-mono text-purple-400/80">/{entity.suggestedSlug}</span>
                                    </p>
                                    {entity.variations?.length > 0 && (
                                        <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                                            Also: {entity.variations.slice(0, 2).join(", ")}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button
                                id={`generate-entity-${entity.suggestedSlug}`}
                                onClick={() => handleGeneratePage(entity)}
                                disabled={generating !== null}
                                className="ml-3 flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-xs rounded transition-colors disabled:opacity-40 border border-emerald-500/20"
                            >
                                <FileText className="w-3 h-3" />
                                {generating === entity.suggestedSlug ? "Writing…" : "Generate page"}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Cluster entities — variations of an existing entity */}
            {clusterEntities.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium flex items-center gap-1.5">
                        <XCircle className="w-3 h-3 text-muted-foreground" />
                        Variations — same cluster as parent entity
                    </p>
                    {clusterEntities.map((entity) => (
                        <div
                            key={entity.suggestedSlug}
                            className="flex items-center gap-2.5 p-3 bg-white/2 rounded-lg opacity-55"
                        >
                            <XCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <div className="min-w-0">
                                <p className="text-sm truncate">{entity.fullName}</p>
                                <p className="text-xs text-muted-foreground">
                                    Cluster parent: {entity.clusterParent}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Summary footer */}
            {entities.length > 0 && (
                <p className="text-xs text-muted-foreground border-t border-white/5 pt-3">
                    {uniqueEntities.length} unique entit{uniqueEntities.length === 1 ? "y" : "ies"} identified.
                    Each generated page will appear in your <span className="text-foreground/80">Blogs</span> section as a Draft.
                </p>
            )}
        </div>
    );
}
