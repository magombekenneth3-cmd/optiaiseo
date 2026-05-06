export function DifficultyBadge({ score }: { score: number | null }) {
    if (score === null || score < 0) return null;

    const label =
        score < 20 ? "Easy"
        : score < 40 ? "Possible"
        : score < 60 ? "Medium"
        : score < 80 ? "Hard"
        : "Very Hard";

    const colors: Record<string, string> = {
        "Easy":      "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
        "Possible":  "bg-green-500/20   text-green-400   border-green-500/20",
        "Medium":    "bg-yellow-500/20  text-yellow-400  border-yellow-500/20",
        "Hard":      "bg-orange-500/20  text-orange-400  border-orange-500/20",
        "Very Hard": "bg-red-500/20     text-red-400     border-red-500/20",
    };

    return (
        <span
            className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border font-medium ${colors[label]}`}
            title={`Keyword Difficulty: ${score}/100`}
        >
            {score} · {label}
        </span>
    );
}
