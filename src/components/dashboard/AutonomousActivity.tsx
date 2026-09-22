"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Activity, ArrowRight, CheckCircle2, AlertCircle, Loader2, Sparkles } from "lucide-react";

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
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function state(status: string): "completed" | "active" | "failed" | "pending" {
  const value = status.toUpperCase();
  if (["COMPLETED", "COMMITTED", "APPROVED", "VERIFIED"].includes(value)) return "completed";
  if (["EXECUTING", "EFFECTS_PENDING", "PENDING_APPROVAL", "RUNNING"].includes(value)) return "active";
  if (["FAILED", "REJECTED"].includes(value)) return "failed";
  return "pending";
}

function Status({ status }: { status: string }) {
  const current = state(status);
  if (current === "completed") return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />Completed</span>;
  if (current === "active") return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand"><Loader2 className="h-3.5 w-3.5 animate-spin" />Running</span>;
  if (current === "failed") return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-400"><AlertCircle className="h-3.5 w-3.5" />Failed</span>;
  return <span className="text-xs font-medium text-muted-foreground">{status.replace(/_/g, " ").toLowerCase()}</span>;
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
      setEvents((data.operations ?? []).map((op: { id: string; mutationType: string; status: string; createdAt: string }) => ({
        id: op.id,
        description: op.mutationType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()),
        status: op.status,
        timestamp: op.createdAt,
      })));
    } catch {
      return;
    } finally {
      setLoaded(true);
    }
  }, [siteId]);

  useEffect(() => {
    if (!initialEvents) fetchEvents();
  }, [fetchEvents, initialEvents]);

  if (!loaded || events.length === 0) return null;

  const activeCount = events.filter((event) => state(event.status) === "active").length;
  const failedCount = events.filter((event) => state(event.status) === "failed").length;

  return (
    <section aria-label="Autopilot activity" className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10 text-brand"><Sparkles className="h-3.5 w-3.5" /></span>
            <h3 className="text-sm font-semibold text-foreground">Currently working</h3>
            {activeCount > 0 && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">{activeCount} active</span>}
            {failedCount > 0 && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-400">{failedCount} failed</span>}
          </div>
          <p className="mt-1 pl-9 text-xs text-muted-foreground">Autonomous work and verification happening across your site.</p>
        </div>
        {siteId && <Link href={`/dashboard/operations?siteId=${siteId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">View activity <ArrowRight className="h-3 w-3" /></Link>}
      </div>

      <div className="divide-y divide-border">
        {events.map((event) => {
          const current = state(event.status);
          return (
            <div key={event.id} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/20">
              <span className={`h-2 w-2 shrink-0 rounded-full ${current === "active" ? "bg-brand shadow-[0_0_10px_rgba(16,185,129,0.6)]" : current === "failed" ? "bg-rose-400" : current === "completed" ? "bg-emerald-400" : "bg-muted-foreground/40"}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{event.description}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(event.timestamp)}</p>
              </div>
              <Status status={event.status} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
