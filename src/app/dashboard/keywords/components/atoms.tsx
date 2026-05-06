"use client";

import { memo } from "react";
import { DIFFICULTY_COLORS } from "../types";

// ─── Spinner ──────────────────────────────────────────────────────────────────
export const Spinner = memo(function Spinner() {
    return (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
});

// ─── Badge ────────────────────────────────────────────────────────────────────
export const Badge = memo(function Badge({
    text,
    className,
}: {
    text: string;
    className: string;
}) {
    return (
        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${className}`}>
            {text}
        </span>
    );
});

// ─── DifficultyLabel ──────────────────────────────────────────────────────────
export const DifficultyLabel = memo(function DifficultyLabel({
    difficulty,
}: {
    difficulty: string;
}) {
    return (
        <span className={`text-[10px] font-bold uppercase ${DIFFICULTY_COLORS[difficulty] ?? "text-muted-foreground"}`}>
            {difficulty} diff
        </span>
    );
});

// ─── SerpFeasibility ─────────────────────────────────────────────────────────
export const SerpFeasibility = memo(function SerpFeasibility({
    score,
}: {
    score: number;
}) {
    const color = score >= 7 ? "text-emerald-400" : score >= 5 ? "text-yellow-400" : "text-red-400";
    const label = score >= 7 ? "Easy" : score >= 5 ? "Moderate" : "Hard";
    return (
        <span
            className={`text-[10px] font-bold ${color}`}
            title={`SERP Feasibility: ${score}/10 — ${label} to outrank top 5`}
        >
            SERP {score}/10
        </span>
    );
});

// ─── ErrorBanner ─────────────────────────────────────────────────────────────
export const ErrorBanner = memo(function ErrorBanner({ message }: { message: string }) {
    if (!message) return null;
    return (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
            {message}
        </div>
    );
});

// ─── PlannerMessage ───────────────────────────────────────────────────────────
export const PlannerMessage = memo(function PlannerMessage({
    msg,
    siteId,
}: {
    msg: { type: "success" | "error"; text: string } | null;
    siteId: string;
}) {
    if (!msg) return null;
    return (
        <div
            className={`text-sm px-4 py-2 rounded-xl border ${
                msg.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}
        >
            {msg.text}
            {msg.type === "success" && (
                <a href={`/dashboard/planner?siteId=${siteId}`} className="ml-2 underline font-bold">
                    View Planner →
                </a>
            )}
        </div>
    );
});

// ─── AddButton ────────────────────────────────────────────────────────────────
export const AddButton = memo(function AddButton({
    added,
    loading,
    onClick,
    title,
}: {
    added: boolean;
    loading: boolean;
    onClick: () => void;
    title?: string;
}) {
    return (
        <button
            onClick={onClick}
            disabled={added || loading}
            className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-all ${
                added
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 cursor-default"
                    : "bg-muted text-muted-foreground border border-border hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/30"
            }`}
            title={title ?? (added ? "Saved" : "Add to Planner")}
        >
            {added ? "✓" : loading ? "…" : "+"}
        </button>
    );
});

// ─── KeywordRowSkeleton ───────────────────────────────────────────────────────
export const KeywordRowSkeleton = memo(function KeywordRowSkeleton() {
    return (
        <div className="flex items-center gap-3 p-3 card-surface rounded-xl animate-pulse">
            <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-muted-foreground/20 rounded w-48" />
                <div className="h-2.5 bg-muted-foreground/10 rounded w-72" />
            </div>
            <div className="w-8 h-8 rounded-lg bg-muted-foreground/10" />
        </div>
    );
});