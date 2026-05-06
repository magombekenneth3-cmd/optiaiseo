type Intent = "informational" | "commercial" | "transactional" | "navigational";

const INTENT_CONFIG: Record<Intent, { label: string; color: string }> = {
    informational:  { label: "Info",  color: "bg-blue-500/20   text-blue-400   border-blue-500/20"   },
    commercial:     { label: "Comm.", color: "bg-purple-500/20 text-purple-400 border-purple-500/20" },
    transactional:  { label: "Trans", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20" },
    navigational:   { label: "Nav",   color: "bg-gray-500/20  text-gray-400   border-gray-500/20"   },
};

export function IntentBadge({ intent }: { intent: string | null }) {
    if (!intent) return null;
    const cfg = INTENT_CONFIG[intent as Intent];
    if (!cfg) return null;
    return (
        <span
            className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.color}`}
            title={`Search intent: ${intent}`}
        >
            {cfg.label}
        </span>
    );
}
