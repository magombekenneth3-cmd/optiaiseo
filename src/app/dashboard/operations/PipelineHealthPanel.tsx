"use client";

import { AlertTriangle, CheckCircle2, CircleGauge, FlaskConical, HeartPulse, ShieldCheck, Wrench } from "lucide-react";

export interface PipelineHealth {
  windowHours: number;
  queriedAt: string;
  authorization: { authorized: number; denied: number; needsApproval: number };
  mutation: { executing: number; completed: number; failed: number; rolledBack: number; completionRate: number | null };
  circuit: { channels: Array<{ channel: string; state: string; consecutiveFailures: number }> };
  budget: { activeReservations: number; consumed: number; released: number; dailyConsumed: number; dailyLimit: number | null };
  experiment: { running: number; completedInWindow: number; wins: number; losses: number; inconclusive: number; aborted: number };
  learning: { activeSignals: number; riskAdjustments: number; confidenceAdjustments: number };
  healing: { completed: number; failed: number; pending: number; dropped: number };
}

function Metric({ label, value, tone = "text-foreground" }: { label: string; value: string | number; tone?: string }) {
  return <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-0.5 text-sm font-semibold ${tone}`}>{value}</p></div>;
}

export function PipelineHealthPanel({ health }: { health: PipelineHealth }) {
  const openCircuits = health.circuit.channels.filter((channel) => channel.state !== "CLOSED");
  const budget = health.budget.dailyLimit === null
    ? "Not configured"
    : `${health.budget.dailyConsumed}/${health.budget.dailyLimit}`;
  const rate = health.mutation.completionRate === null ? "—" : `${Math.round(health.mutation.completionRate * 100)}%`;
  const cards = [
    { title: "Authorization", icon: ShieldCheck, tone: health.authorization.denied ? "text-amber-400" : "text-emerald-400", metrics: [["Authorized", health.authorization.authorized], ["Needs review", health.authorization.needsApproval], ["Denied", health.authorization.denied]] },
    { title: "Mutation health", icon: HeartPulse, tone: health.mutation.failed ? "text-rose-400" : "text-cyan-400", metrics: [["Executing", health.mutation.executing], ["Completion", rate], ["Failed", health.mutation.failed]] },
    { title: "Safety controls", icon: CircleGauge, tone: openCircuits.length ? "text-rose-400" : "text-emerald-400", metrics: [["Open circuits", openCircuits.length], ["Budget today", budget], ["Reserved", health.budget.activeReservations]] },
    { title: "Learning & healing", icon: Wrench, tone: health.healing.failed ? "text-rose-400" : "text-violet-400", metrics: [["Active signals", health.learning.activeSignals], ["Healing pending", health.healing.pending], ["Healing failed", health.healing.failed]] },
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div><h2 className="text-sm font-semibold">Autonomy pipeline</h2><p className="text-xs text-muted-foreground">Current state and last {health.windowHours}h of activity</p></div>
        {openCircuits.length > 0 && <span className="inline-flex items-center gap-1 text-xs text-rose-400"><AlertTriangle className="h-3.5 w-3.5" /> Circuit attention needed</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return <div key={card.title} className="card-surface p-4"><div className="mb-3 flex items-center gap-2"><Icon className={`h-4 w-4 ${card.tone}`} /><h3 className="text-xs font-semibold">{card.title}</h3></div><div className="grid grid-cols-3 gap-2">{card.metrics.map(([label, value]) => <Metric key={String(label)} label={String(label)} value={value} tone={card.tone} />)}</div></div>;
        })}
      </div>
      {(openCircuits.length > 0 || health.experiment.running > 0) && <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">{openCircuits.map((channel) => <span key={channel.channel} className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-rose-400">{channel.channel}: {channel.state}</span>)}{health.experiment.running > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-violet-300"><FlaskConical className="h-3 w-3" /> {health.experiment.running} running experiment{health.experiment.running === 1 ? "" : "s"}</span>}<span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-300"><CheckCircle2 className="h-3 w-3" /> {health.healing.completed} healed</span></div>}
    </section>
  );
}
