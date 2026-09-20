"use client";

import type { TopicSpokeNode } from "@/lib/blog/topical-matrix";

interface GraphNode {
    id: string;
    label: string;
    isPillar: boolean;
    isOrphan: boolean;
    x: number;
    y: number;
}

interface GraphEdge {
    fromId: string;
    toId: string;
    /** solid = detected mention in content; dashed = undetected (opportunity) */
    style: "solid" | "dashed";
}

interface Props {
    pillar?: TopicSpokeNode;
    spokes: TopicSpokeNode[];
}

const W = 320;
const H = 200;
const CX = W / 2;
const CY = H / 2;
const PILLAR_R = 28;
const SPOKE_R = 18;
const ORBIT_R = 78;

function truncate(str: string, max: number) {
    return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

export function LinkGraphSvg({ pillar, spokes }: Props) {
    if (!pillar && spokes.length === 0) return null;

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Pillar at centre
    if (pillar) {
        nodes.push({
            id: pillar.id,
            label: truncate(pillar.title, 18),
            isPillar: true,
            isOrphan: false,
            x: CX,
            y: CY,
        });
    }

    // Spokes evenly distributed around orbit
    const total = spokes.length;
    spokes.forEach((spoke, i) => {
        const angle = (2 * Math.PI * i) / Math.max(total, 1) - Math.PI / 2;
        const x = CX + ORBIT_R * Math.cos(angle);
        const y = CY + ORBIT_R * Math.sin(angle);
        const isOrphan = spoke.inboundClusterMentionCount === 0;
        nodes.push({ id: spoke.id, label: truncate(spoke.title, 14), isPillar: false, isOrphan, x, y });

        if (pillar) {
            edges.push({
                fromId: pillar.id,
                toId: spoke.id,
                style: isOrphan ? "dashed" : "solid",
            });
        }
    });

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    function arrowPath(from: GraphNode, to: GraphNode, toR: number) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return "";
        const ux = dx / dist;
        const uy = dy / dist;
        // End point pulled back by target radius + arrowhead length
        const ex = to.x - ux * (toR + 6);
        const ey = to.y - uy * (toR + 6);
        return `M ${from.x} ${from.y} L ${ex} ${ey}`;
    }

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            aria-label="Cluster internal link graph"
            className="overflow-visible"
        >
            <defs>
                <marker id="arrow-solid" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="rgb(52,211,153)" />
                </marker>
                <marker id="arrow-dashed" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="rgb(100,116,139)" />
                </marker>
            </defs>

            {/* Edges */}
            {edges.map(edge => {
                const from = nodeMap.get(edge.fromId);
                const to = nodeMap.get(edge.toId);
                if (!from || !to) return null;
                const toR = to.isPillar ? PILLAR_R : SPOKE_R;
                const d = arrowPath(from, to, toR);
                return (
                    <path
                        key={`${edge.fromId}-${edge.toId}`}
                        d={d}
                        fill="none"
                        stroke={edge.style === "solid" ? "rgb(52,211,153)" : "rgb(100,116,139)"}
                        strokeWidth={edge.style === "solid" ? 1.5 : 1}
                        strokeDasharray={edge.style === "dashed" ? "4 3" : undefined}
                        strokeOpacity={edge.style === "solid" ? 0.6 : 0.35}
                        markerEnd={`url(#arrow-${edge.style})`}
                    />
                );
            })}

            {/* Nodes */}
            {nodes.map(node => {
                const r = node.isPillar ? PILLAR_R : SPOKE_R;
                const fill = node.isPillar
                    ? "rgba(52,211,153,0.12)"
                    : node.isOrphan
                        ? "rgba(251,191,36,0.08)"
                        : "rgba(30,41,59,0.8)";
                const stroke = node.isPillar
                    ? "rgba(52,211,153,0.5)"
                    : node.isOrphan
                        ? "rgba(251,191,36,0.4)"
                        : "rgba(100,116,139,0.3)";

                return (
                    <g key={node.id}>
                        <circle cx={node.x} cy={node.y} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />
                        <text
                            x={node.x}
                            y={node.y}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={node.isPillar ? 7 : 6}
                            fill={node.isPillar ? "rgb(52,211,153)" : node.isOrphan ? "rgb(251,191,36)" : "rgb(148,163,184)"}
                            fontWeight={node.isPillar ? "700" : "400"}
                        >
                            {node.label}
                        </text>
                        {/* Orphan warning dot */}
                        {node.isOrphan && !node.isPillar && (
                            <circle cx={node.x + r - 4} cy={node.y - r + 4} r={5} fill="rgb(251,191,36)" />
                        )}
                    </g>
                );
            })}
        </svg>
    );
}
