"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";

interface ActivityEvent {
    id: string;
    description: string;
    status: string;
    timestamp: string;
}

interface Props {
    siteId: string | null;
    initialEvents?: ActivityEvent[];
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return "Just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function resolveStepState(status: string): "completed" | "active" | "failed" | "" {
    const upper = status.toUpperCase();
    if (upper === "COMPLETED" || upper === "COMMITTED" || upper === "APPROVED") return "completed";
    if (upper === "EXECUTING" || upper === "EFFECTS_PENDING" || upper === "PENDING_APPROVAL") return "active";
    if (upper === "FAILED" || upper === "REJECTED") return "failed";
    return "";
}

export function AutonomousActivity({ siteId, initialEvents }: Props) {
    const [events, setEvents] = useState<ActivityEvent[]>(initialEvents ?? []);
    const [loaded, setLoaded] = useState(!!initialEvents);

    const fetchEvents = useCallback(async () => {
        if (!siteId) return;
        try {
            const res = await fetch(`/api/operations?siteId=${siteId}&limit=5`);
            if (!res.ok) return;
            const data = await res.json();
            const ops = (data.operations ?? []).map((op: { id: string; mutationType: string; status: string; createdAt: string }) => ({
                id: op.id,
                description: op.mutationType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()),
                status: op.status,
                timestamp: op.createdAt,
            }));
            setEvents(ops);
        } catch {
            // silent
        } finally {
            setLoaded(true);
        }
    }, [siteId]);

    useEffect(() => {
        if (!initialEvents) {
            fetchEvents();
        }
    }, [fetchEvents, initialEvents]);

    if (!loaded || events.length === 0) return null;

    return (
        <section aria-label="Autonomous activity">
            <div className="flex items-center justify-between mb-3">
                <p className="section-label flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" aria-hidden="true" />
                    Autonomous Activity
                </p>
                {siteId && (
                    <Link
                        href={`/dashboard/operations?siteId=${siteId}`}
                        className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
                    >
                        View all <ArrowRight className="w-3 h-3" />
                    </Link>
                )}
            </div>

            <div className="lifecycle-track">
                {events.map((event) => {
                    const stepState = resolveStepState(event.status);
                    return (
                        <div
                            key={event.id}
                            className={`lifecycle-step ${stepState}`}
                        >
                            <span className="flex-1 min-w-0 truncate">{event.description}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                                {timeAgo(event.timestamp)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
