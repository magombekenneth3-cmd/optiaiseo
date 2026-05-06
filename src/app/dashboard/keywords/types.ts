// ─── Shared Types ─────────────────────────────────────────────────────────────
// Centralised so every tab imports from one place instead of re-declaring.

export type Intent = "informational" | "commercial" | "transactional" | "navigational";
export type Difficulty = "low" | "medium" | "high";
export type FilterCategory = "all" | "informational" | "commercial" | "transactional";
export type TabId = "hub" | "ai" | "seed" | "sitemap" | "ideas" | "gsc" | "community";

export interface PlannerMsg {
    type: "success" | "error";
    text: string;
}

// ─── Colour Maps ──────────────────────────────────────────────────────────────
// Defined once, consumed everywhere — no more duplicate objects spread across
// 1 176 lines.

export const INTENT_COLORS: Record<string, string> = {
    informational: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    commercial: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    transactional: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    navigational: "bg-zinc-500/10 text-muted-foreground border-zinc-500/20",
};

export const CATEGORY_COLORS: Record<string, string> = {
    informational: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    commercial: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    transactional: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

export const DIFFICULTY_COLORS: Record<string, string> = {
    low: "text-emerald-400",
    medium: "text-yellow-400",
    high: "text-red-400",
};