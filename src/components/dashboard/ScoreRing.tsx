"use client";

import { useEffect, useRef, useState } from "react";

interface ScoreRingProps {
    score: number;
    /** Context label for screen readers, e.g. "SEO score for example.com" */
    title?: string;
    size?: number;
}

export function ScoreRing({ score, title, size = 64 }: ScoreRingProps) {
    const [displayScore, setDisplayScore] = useState(0);
    const animatedRef = useRef(false);

    useEffect(() => {
        if (animatedRef.current) return;
        animatedRef.current = true;

        const start = performance.now();
        const duration = 600;

        const tick = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplayScore(Math.round(eased * score));
            if (progress < 1) requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
    }, [score]);

    const color =
        score >= 75 ? "#10b981" :
            score >= 50 ? "#f59e0b" :
                "#f43f5e";

    const r = (size / 2) - 6;
    const circumference = 2 * Math.PI * r;
    const offset = circumference - (displayScore / 100) * circumference;
    const cx = size / 2;

    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={title ?? `Score: ${score} out of 100`}
        >
            <title>{title ?? `Score: ${score}/100`}</title>
            {/* Track */}
            <circle
                cx={cx} cy={cx} r={r}
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="4"
            />
            {/* Progress arc */}
            <circle
                cx={cx} cy={cx} r={r}
                fill="none"
                stroke={color}
                strokeWidth="4"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform={`rotate(-90 ${cx} ${cx})`}
            />
            {/* Score label */}
            <text
                x={cx} y={cx + 5}
                textAnchor="middle"
                fontSize="14"
                fontWeight="700"
                fill={color}
                aria-hidden="true"
            >
                {displayScore}
            </text>
        </svg>
    );
}
