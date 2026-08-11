import { Badge, BadgeVariant } from "@/components/ui/Badge";

export function DifficultyBadge({ score }: { score: number | null }) {
    if (score === null || score < 0) return null;

    const label =
        score < 20 ? "Easy"
        : score < 40 ? "Possible"
        : score < 60 ? "Medium"
        : score < 80 ? "Hard"
        : "Very Hard";

    const variant: BadgeVariant =
        score < 40 ? "success"
        : score < 60 ? "warning"
        : "danger";

    return (
        <Badge
            variant={variant}
            className="rounded-full font-medium"
        >
            {score} · {label}
        </Badge>
    );
}
