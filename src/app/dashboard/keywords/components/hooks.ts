"use client";

/**
 * hooks.ts — all keyword-discovery state hooks
 *
 * Shared primitives:
 *   useAddedSet      — tracks which keywords are saved in this session
 *   useAsyncAction   — eliminates loading/error boilerplate from every tab
 *
 * Tab hooks (one per tab, each consumes the primitives above):
 *   useResearchHub, useAIDiscovery, useSeedKeywords,
 *   useSitemapImport, useFreeIdeas, useGscPatterns, useCommunity
 */

import { useState, useCallback } from "react";
import type { PlannerMsg } from "../types";
import {
    addSeedKeyword,
    generateResearchHubKeywords,
    generateContentCalendarPages,
    discoverKeywordsWithAI,
    importKeywordsFromSitemap,
    getSeedKeywords,
    deleteSeedKeyword,
    getKeywordIdeas,
    generateGscQuestionPatterns,
    getCommunityKeywords,
    type DiscoveredKeyword,
    type SeedKeyword,
    type ResearchHubKeyword,
    type ResearchHubCluster,
    type ResearchHubResult,
    type CalendarEntry,
} from "@/app/actions/keywordDiscovery";
import { saveKeywordsToPlanner } from "@/app/actions/planner";
import type { CommunityKeyword } from "@/lib/keywords/community";

// Re-export so tabs only need one import source
export type {
    DiscoveredKeyword,
    SeedKeyword,
    ResearchHubKeyword,
    ResearchHubCluster,
    ResearchHubResult,
    CalendarEntry,
    CommunityKeyword,
};

// ─── useAddedSet ──────────────────────────────────────────────────────────────
export function useAddedSet() {
    const [addedSet, setAddedSet] = useState<Set<string>>(new Set());
    const markAdded = useCallback((key: string) => {
        setAddedSet((prev) => new Set([...prev, key]));
    }, []);
    const isAdded = useCallback((key: string) => addedSet.has(key), [addedSet]);
    return { addedSet, markAdded, isAdded };
}

// ─── useAsyncAction ───────────────────────────────────────────────────────────
export function useAsyncAction() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
        setLoading(true);
        setError("");
        try {
            return await fn();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Unknown error");
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    return { loading, error, setError, run };
}

// ─── useResearchHub ───────────────────────────────────────────────────────────
export type ResearchView = "generate" | "filter" | "cluster";

export function useResearchHub(siteId: string) {
    const { loading, error, setError, run } = useAsyncAction();
    const { addedSet, markAdded, isAdded } = useAddedSet();

    const [step, setStep] = useState<ResearchView>("generate");
    const [productDesc, setProductDesc] = useState("");
    const [result, setResult] = useState<ResearchHubResult | null>(null);
    const [quickWinsOnly, setQuickWinsOnly] = useState(false);
    const [filterCategory, setFilterCategory] = useState<
        "all" | "informational" | "commercial" | "transactional"
    >("all");
    const [adding, setAdding] = useState<string | null>(null);
    const [calendarLoading, setCalendarLoading] = useState(false);
    const [expandedClusters, setExpandedClusters] = useState<Set<number>>(new Set());
    const [clusterSaving, setClusterSaving] = useState<number | null>(null);
    const [clusterSaved, setClusterSaved] = useState<Set<number>>(new Set());
    const [plannerSaving, setPlannerSaving] = useState(false);
    const [plannerMsg, setPlannerMsg] = useState<PlannerMsg | null>(null);
    const [calendar, setCalendar] = useState<CalendarEntry[]>([]);

    const displayKeywords = result
        ? quickWinsOnly
            ? result.quickWins
            : filterCategory === "all"
                ? result.keywords
                : result.keywords.filter((kw) => kw.category === filterCategory)
        : [];

    const handleGenerate = async () => {
        if (!productDesc.trim()) return;
        const res = await run(() => generateResearchHubKeywords(siteId, productDesc.trim()));
        if (res?.success) {
            setResult(res.result);
            setStep("filter");
        } else if (res) {
            setError(res.error);
        }
    };

    // Bug 1 fix: check server response before marking keyword as added
    const handleAddKeyword = async (kw: ResearchHubKeyword) => {
        setAdding(kw.keyword);
        const res = await addSeedKeyword(
            siteId,
            kw.keyword,
            kw.intent,
            1,
            `Research Hub — ${kw.parentTopic}`
        );
        if (res.success) {
            await saveKeywordsToPlanner(siteId, [
                {
                    keyword: kw.keyword,
                    intent: kw.intent,
                    parentTopic: kw.parentTopic,
                    difficulty: kw.difficulty,
                    reason: kw.reason,
                },
            ]);
            markAdded(kw.keyword);
        } else {
            setError(res.error ?? "Failed to save keyword");
        }
        setAdding(null);
    };

    // Bug 4 fix: parallel saves via Promise.all instead of serial awaits
    const handleAddCluster = async (cluster: ResearchHubCluster, ci: number) => {
        setClusterSaving(ci);
        const toAdd = cluster.keywords.slice(0, 10).filter((kw) => !isAdded(kw.keyword));

        // Bug 1 fix: check each server response before marking added
        await Promise.all(
            toAdd.map((kw) =>
                addSeedKeyword(siteId, kw.keyword, kw.intent, 1, `Cluster: ${cluster.parentTopic}`).then(
                    (res) => {
                        if (res.success) markAdded(kw.keyword);
                    }
                )
            )
        );

        await saveKeywordsToPlanner(
            siteId,
            cluster.keywords.slice(0, 10).map((kw) => ({
                keyword: kw.keyword,
                intent: kw.intent,
                parentTopic: cluster.parentTopic,
                difficulty: kw.difficulty,
                reason: kw.reason,
            }))
        );
        setClusterSaving(null);
        setClusterSaved((prev) => new Set([...prev, ci]));
        setTimeout(
            () =>
                setClusterSaved((prev) => {
                    const s = new Set(prev);
                    s.delete(ci);
                    return s;
                }),
            3000
        );
    };

    const handleSaveFilteredToPlanner = async () => {
        if (!displayKeywords.length) return;
        setPlannerSaving(true);
        setPlannerMsg(null);
        const res = await saveKeywordsToPlanner(
            siteId,
            displayKeywords.map((kw) => ({
                keyword: kw.keyword,
                intent: kw.intent,
                parentTopic: kw.parentTopic,
                difficulty: kw.difficulty,
                reason: kw.reason,
            }))
        );
        setPlannerSaving(false);
        setPlannerMsg(
            res.success
                ? {
                      type: "success",
                      text: `✅ ${res.addedCount} keyword${res.addedCount !== 1 ? "s" : ""} saved to Planner!`,
                  }
                : { type: "error", text: res.error ?? "Failed" }
        );
    };

    const handleGenerateCalendar = async () => {
        if (!result) return;
        setCalendarLoading(true);
        const map = result.clusters.map((c) => ({
            topic: c.parentTopic,
            keywords: c.keywords.slice(0, 3).map((k) => k.keyword),
        }));
        const res = await generateContentCalendarPages(siteId, map);
        setCalendarLoading(false);
        if (res.success && res.result?.calendar) {
            setCalendar(res.result.calendar);
        } else if (!res.success) {
            setError(res.error || "Failed");
        }
    };

    const toggleClusterExpand = (ci: number) =>
        setExpandedClusters((prev) => {
            const s = new Set(prev);
            if (s.has(ci)) { s.delete(ci); } else { s.add(ci); }
            return s;
        });

    return {
        step, setStep,
        productDesc, setProductDesc,
        result,
        quickWinsOnly, setQuickWinsOnly,
        filterCategory, setFilterCategory,
        adding,
        calendarLoading,
        expandedClusters,
        clusterSaving,
        clusterSaved,
        plannerSaving,
        plannerMsg,
        calendar,
        displayKeywords,
        loading,
        error,
        addedSet,
        isAdded,
        handleGenerate,
        handleAddKeyword,
        handleAddCluster,
        handleSaveFilteredToPlanner,
        handleGenerateCalendar,
        toggleClusterExpand,
    };
}

// ─── useAIDiscovery ───────────────────────────────────────────────────────────
export function useAIDiscovery(siteId: string) {
    const { loading, error, run } = useAsyncAction();
    const { addedSet, markAdded, isAdded } = useAddedSet();

    const [keywords, setKeywords] = useState<DiscoveredKeyword[]>([]);
    const [adding, setAdding] = useState<string | null>(null);
    const [savingToPlanner, setSavingToPlanner] = useState(false);
    const [plannerMsg, setPlannerMsg] = useState<PlannerMsg | null>(null);

    const handleDiscover = async () => {
        const res = await run(() => discoverKeywordsWithAI(siteId));
        if (res?.success) setKeywords(res.keywords);
    };

    // Bug 1 fix: check server response before marking added
    const handleAdd = async (kw: DiscoveredKeyword) => {
        setAdding(kw.keyword);
        const res = await addSeedKeyword(siteId, kw.keyword, kw.intent, 1, kw.reason);
        if (res.success) {
            await saveKeywordsToPlanner(siteId, [
                { keyword: kw.keyword, intent: kw.intent, difficulty: kw.difficulty, reason: kw.reason },
            ]);
            markAdded(kw.keyword);
        }
        setAdding(null);
    };

    const handleSaveAllToPlanner = async () => {
        const toSave = keywords.filter((kw) => (addedSet.size > 0 ? isAdded(kw.keyword) : true));
        if (!toSave.length) return;
        setSavingToPlanner(true);
        const res = await saveKeywordsToPlanner(
            siteId,
            toSave.map((kw) => ({
                keyword: kw.keyword,
                intent: kw.intent,
                reason: kw.reason,
                difficulty: kw.difficulty,
            }))
        );
        setSavingToPlanner(false);
        setPlannerMsg(
            res.success
                ? {
                      type: "success",
                      text: `✅ ${res.addedCount} keyword${res.addedCount !== 1 ? "s" : ""} saved to Content Planner!`,
                  }
                : { type: "error", text: res.error ?? "Failed" }
        );
    };

    return {
        keywords,
        loading,
        error,
        adding,
        addedSet,
        isAdded,
        savingToPlanner,
        plannerMsg,
        handleDiscover,
        handleAdd,
        handleSaveAllToPlanner,
    };
}

// ─── useSeedKeywords ──────────────────────────────────────────────────────────
export function useSeedKeywords(siteId: string) {
    const [keywords, setKeywords] = useState<SeedKeyword[]>([]);
    const [input, setInput] = useState("");
    const [notes, setNotes] = useState("");
    const [adding, setAdding] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        const res = await getSeedKeywords(siteId);
        setLoading(false);
        if (res.success) setKeywords(res.keywords);
    }, [siteId]);

    const handleAdd = async () => {
        if (!input.trim()) return;
        setAdding(true);
        const res = await addSeedKeyword(siteId, input.trim(), undefined, 1, notes.trim() || undefined);
        if (res.success) {
            await saveKeywordsToPlanner(siteId, [{ keyword: input.trim() }]);
            setKeywords((prev) => [
                {
                    id: res.id,
                    keyword: input.trim(),
                    targetPosition: 1,
                    notes: notes.trim() || undefined,
                    addedAt: new Date().toISOString(),
                },
                ...prev,
            ]);
            setInput("");
            setNotes("");
        } else {
            setError(res.error);
        }
        setAdding(false);
    };

    // Bug 2 fix: only remove from local state when server confirms deletion
    const handleDelete = async (id: string) => {
        setDeleting(id);
        const res = await deleteSeedKeyword(id);
        if (res.success) {
            setKeywords((prev) => prev.filter((k) => k.id !== id));
        } else {
            setError(res.error ?? "Failed to delete keyword");
        }
        setDeleting(null);
    };

    return {
        keywords,
        input, setInput,
        notes, setNotes,
        adding,
        deleting,
        loading,
        error,
        load,
        handleAdd,
        handleDelete,
    };
}

// ─── useSitemapImport ─────────────────────────────────────────────────────────
export function useSitemapImport(siteId: string) {
    const { loading, error, run } = useAsyncAction();
    const { addedSet, markAdded } = useAddedSet();
    const [pages, setPages] = useState<{ url: string; keywords: DiscoveredKeyword[] }[]>([]);
    const [adding, setAdding] = useState<string | null>(null);

    const handleImport = async () => {
        const res = await run(() => importKeywordsFromSitemap(siteId));
        if (res?.success) setPages(res.pages);
    };

    const handleAdd = async (kw: DiscoveredKeyword, pageUrl: string) => {
        const key = `${pageUrl}::${kw.keyword}`;
        setAdding(key);
        const res = await addSeedKeyword(siteId, kw.keyword, kw.intent, 1, `Target page: ${pageUrl}`);
        if (res.success) {
            await saveKeywordsToPlanner(siteId, [
                { keyword: kw.keyword, intent: kw.intent, difficulty: kw.difficulty, reason: `Target page: ${pageUrl}` },
            ]);
            markAdded(key);
        }
        setAdding(null);
    };

    return { pages, loading, error, adding, addedSet, handleImport, handleAdd };
}

// ─── useFreeIdeas ─────────────────────────────────────────────────────────────
export function useFreeIdeas(siteId: string) {
    const { loading, error, run } = useAsyncAction();
    const { addedSet, markAdded } = useAddedSet();
    const [seed, setSeed] = useState("");
    const [keywords, setKeywords] = useState<{ keyword: string }[]>([]);
    const [adding, setAdding] = useState<string | null>(null);

    const handleDiscover = async () => {
        if (!seed.trim()) return;
        const res = await run(() => getKeywordIdeas(seed.trim()));
        if (res?.success) setKeywords(res.keywords);
    };

    const handleAdd = async (keyword: string) => {
        setAdding(keyword);
        const res = await addSeedKeyword(siteId, keyword, undefined, 1, "From Autocomplete Ideas");
        if (res.success) markAdded(keyword);
        setAdding(null);
    };

    return { seed, setSeed, keywords, loading, error, adding, addedSet, handleDiscover, handleAdd };
}

// ─── useGscPatterns ───────────────────────────────────────────────────────────
export function useGscPatterns(siteId: string) {
    const { loading, error, run } = useAsyncAction();
    const [data, setData] = useState<{
        brandedPattern: string;
        questionPattern: string;
        tips: string[];
    } | null>(null);
    const [copied, setCopied] = useState("");

    const handleGenerate = async () => {
        const res = await run(() => generateGscQuestionPatterns(siteId));
        if (res?.success && res.result) setData(res.result);
    };

    const copyLine = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(text);
        setTimeout(() => setCopied(""), 2000);
    };

    return { data, loading, error, copied, handleGenerate, copyLine };
}

// ─── useCommunity ─────────────────────────────────────────────────────────────
export function useCommunity(siteId: string) {
    const { loading, error, run } = useAsyncAction();
    const { addedSet, markAdded } = useAddedSet();
    const [keywords, setKeywords] = useState<CommunityKeyword[]>([]);
    const [adding, setAdding] = useState<string | null>(null);

    const handleMine = async () => {
        const res = await run(() => getCommunityKeywords(siteId));
        if (res?.success && res.keywords) setKeywords(res.keywords);
    };

    const handleAdd = async (kw: CommunityKeyword) => {
        setAdding(kw.keyword);
        const res = await addSeedKeyword(
            siteId,
            kw.keyword,
            "informational",
            1,
            `Mined from ${kw.source}: ${kw.questionPattern}`
        );
        if (res.success) markAdded(kw.keyword);
        setAdding(null);
    };

    return { keywords, loading, error, adding, addedSet, handleMine, handleAdd };
}
