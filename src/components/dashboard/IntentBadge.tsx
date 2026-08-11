import { Badge, BadgeVariant } from "@/components/ui/Badge";

type Intent = "informational" | "commercial" | "transactional" | "navigational";

const INTENT_CONFIG: Record<Intent, { label: string; variant: BadgeVariant }> = {
    informational:  { label: "Info",  variant: "info" },
    commercial:     { label: "Comm.", variant: "warning" },
    transactional:  { label: "Trans", variant: "success" },
    navigational:   { label: "Nav",   variant: "neutral" },
};

export function IntentBadge({ intent }: { intent: string | null }) {
    if (!intent) return null;
    const cfg = INTENT_CONFIG[intent as Intent];
    if (!cfg) return null;
    return (
        <Badge
            variant={cfg.variant}
            className="rounded-full font-medium"
        >
            {cfg.label}
        </Badge>
    );
}
