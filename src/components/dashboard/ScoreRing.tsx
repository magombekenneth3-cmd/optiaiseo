export function ScoreRing({ score }: { score: number, size?: number; }) {
    const color =
        score >= 75 ? "#10b981" :
            score >= 50 ? "#f59e0b" :
                "#f43f5e";
    const r = 26;
    const circumference = 2 * Math.PI * r;
    const offset = circumference - (score / 100) * circumference;

    return (
        <svg width="64" height="64" viewBox="0 0 64 64" aria-label={`Score: ${score}`}>
            <circle
                cx="32" cy="32" r={r}
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="4"
            />
            <circle
                cx="32" cy="32" r={r}
                fill="none"
                stroke={color}
                strokeWidth="4"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform="rotate(-90 32 32)"
                style={{ transition: "stroke-dashoffset 0.6s ease" }}
            />
            <text
                x="32" y="37"
                textAnchor="middle"
                fontSize="14"
                fontWeight="700"
                fill={color}
            >
                {score}
            </text>
        </svg>
    );
}
