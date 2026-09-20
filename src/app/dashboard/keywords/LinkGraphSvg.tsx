"use client";

import type { TopicSpokeNode } from "@/lib/blog/topical-matrix";

interface Props {
    pillar?: TopicSpokeNode;
    spokes: TopicSpokeNode[];
}

// Layout constants
const W = 340;
const H = 220;
const CX = W / 2;
const CY = H / 2;
const ORBIT_R = 84;
const PILLAR_R = 32;
const SPOKE_R = 22;
const LABEL_MAX = 16;

function clip(str: string, max: number) {
    return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

/** Break a label into at most 2 lines of `width` chars */
function wrapLabel(str: string, width: number): [string, string] {
    if (str.length <= width) return [str, ""];
    const mid = str.lastIndexOf(" ", width);
    if (mid > 0) return [str.slice(0, mid), clip(str.slice(mid + 1), width)];
    return [str.slice(0, width - 1) + "…", ""];
}

function arrow(from: { x: number; y: number }, to: { x: number; y: number }, toR: number) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return "";
    const ux = dx / dist;
    const uy = dy / dist;
    return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} L ${(to.x - ux * (toR + 7)).toFixed(1)} ${(to.y - uy * (toR + 7)).toFixed(1)}`;
}

export function LinkGraphSvg({ pillar, spokes }: Props) {
    if (!pillar && spokes.length === 0) return null;

    const pillarPos = { x: CX, y: CY };

    const spokePositions = spokes.map((_, i) => {
        const angle = (2 * Math.PI * i) / Math.max(spokes.length, 1) - Math.PI / 2;
        return {
            x: CX + ORBIT_R * Math.cos(angle),
            y: CY + ORBIT_R * Math.sin(angle),
        };
    });

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            aria-label="Cluster internal link graph"
            style={{ overflow: "visible" }}
        >
            <defs>
                <marker id="arr-solid" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <polygon points="0 0, 7 3.5, 0 7" fill="rgba(52,211,153,0.7)" />
                </marker>
                <marker id="arr-dashed" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <polygon points="0 0, 7 3.5, 0 7" fill="rgba(100,116,139,0.5)" />
                </marker>
                <radialGradient id="pillar-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(52,211,153,0.25)" />
                    <stop offset="100%" stopColor="rgba(52,211,153,0.04)" />
                </radialGradient>
                <radialGradient id="orphan-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(251,191,36,0.2)" />
                    <stop offset="100%" stopColor="rgba(251,191,36,0.03)" />
                </radialGradient>
                <filter id="glow-em" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="2.5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>

            {/* Edges — draw before nodes so nodes sit on top */}
            {pillar && spokes.map((spoke, i) => {
                const to = spokePositions[i];
                const isLinked = spoke.inboundClusterMentionCount > 0;
                const d = arrow(pillarPos, to, SPOKE_R);
                return (
                    <path
                        key={spoke.id + "-edge"}
                        d={d}
                        fill="none"
                        stroke={isLinked ? "rgba(52,211,153,0.55)" : "rgba(100,116,139,0.3)"}
                        strokeWidth={isLinked ? 1.5 : 1}
                        strokeDasharray={isLinked ? undefined : "5 3"}
                        markerEnd={`url(#arr-${isLinked ? "solid" : "dashed"})`}
                    />
                );
            })}

            {/* Pillar node */}
            {pillar && (() => {
                const [l1, l2] = wrapLabel(clip(pillar.title, LABEL_MAX + 4), LABEL_MAX);
                return (
                    <g filter="url(#glow-em)">
                        <circle cx={CX} cy={CY} r={PILLAR_R + 8} fill="url(#pillar-glow)" />
                        <circle
                            cx={CX} cy={CY} r={PILLAR_R}
                            fill="rgba(13,17,23,0.95)"
                            stroke="rgba(52,211,153,0.55)"
                            strokeWidth={1.8}
                        />
                        <text x={CX} y={l2 ? CY - 5 : CY} textAnchor="middle" dominantBaseline="middle"
                            fontSize={7.5} fontWeight="700" fill="rgb(52,211,153)" letterSpacing="0.02em">
                            {l1}
                        </text>
                        {l2 && (
                            <text x={CX} y={CY + 8} textAnchor="middle" dominantBaseline="middle"
                                fontSize={7.5} fontWeight="700" fill="rgb(52,211,153)" letterSpacing="0.02em">
                                {l2}
                            </text>
                        )}
                        <text x={CX} y={CY + PILLAR_R + 10} textAnchor="middle"
                            fontSize={6.5} fill="rgba(52,211,153,0.5)" fontWeight="600" letterSpacing="0.08em">
                            PILLAR
                        </text>
                    </g>
                );
            })()}

            {/* Spoke nodes */}
            {spokes.map((spoke, i) => {
                const pos = spokePositions[i];
                const isOrphan = spoke.inboundClusterMentionCount === 0;
                const [l1, l2] = wrapLabel(clip(spoke.title, 13), 13);
                const strokeColor = isOrphan ? "rgba(251,191,36,0.5)" : "rgba(100,116,139,0.35)";
                const textColor = isOrphan ? "rgb(251,191,36)" : "rgb(148,163,184)";
                return (
                    <g key={spoke.id}>
                        {isOrphan && (
                            <circle cx={pos.x} cy={pos.y} r={SPOKE_R + 6} fill="url(#orphan-glow)" />
                        )}
                        <circle
                            cx={pos.x} cy={pos.y} r={SPOKE_R}
                            fill="rgba(13,17,23,0.95)"
                            stroke={strokeColor}
                            strokeWidth={1.5}
                            strokeDasharray={isOrphan ? "3 2" : undefined}
                        />
                        <text x={pos.x} y={l2 ? pos.y - 4 : pos.y} textAnchor="middle"
                            dominantBaseline="middle" fontSize={6.5} fill={textColor} fontWeight="500">
                            {l1}
                        </text>
                        {l2 && (
                            <text x={pos.x} y={pos.y + 6} textAnchor="middle"
                                dominantBaseline="middle" fontSize={6.5} fill={textColor} fontWeight="500">
                                {l2}
                            </text>
                        )}
                        {isOrphan && (
                            <>
                                <circle cx={pos.x + SPOKE_R - 5} cy={pos.y - SPOKE_R + 5} r={6}
                                    fill="rgb(251,191,36)" />
                                <text x={pos.x + SPOKE_R - 5} y={pos.y - SPOKE_R + 5}
                                    textAnchor="middle" dominantBaseline="middle"
                                    fontSize={7} fontWeight="800" fill="rgb(13,17,23)">
                                    !
                                </text>
                            </>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}
