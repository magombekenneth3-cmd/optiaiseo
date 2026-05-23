"use client";

import { useState, useEffect } from "react";
import { Zap, Clock, Mail, RefreshCw } from "lucide-react";
import { updateAutopilotConfig, generatePublicBadgeToken } from "@/app/actions/aeoAutopilot";

type Schedule = "daily" | "weekly" | "biweekly";

interface Props {
  siteId: string;
  initialEnabled: boolean;
  initialSchedule: string;
  initialDigestEnabled: boolean;
  initialBadgeToken: string | null;
  siteUrl: string;
}

const SCHEDULES: { value: Schedule; label: string; desc: string }[] = [
  { value: "daily", label: "Daily", desc: "Every day at 7am UTC" },
  { value: "weekly", label: "Weekly", desc: "Every Monday" },
  { value: "biweekly", label: "Bi-weekly", desc: "First Monday of the fortnight" },
];

export function AeoAutopilotPanel({ siteId, initialEnabled, initialSchedule, initialDigestEnabled, initialBadgeToken, siteUrl }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [schedule, setSchedule] = useState<Schedule>((initialSchedule as Schedule) ?? "weekly");
  const [digestEnabled, setDigestEnabled] = useState(initialDigestEnabled);
  const [saving, setSaving] = useState(false);
  const [badgeToken, setBadgeToken] = useState<string | null>(initialBadgeToken);
  const [generatingBadge, setGeneratingBadge] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fixLog, setFixLog] = useState<{ action: string; appliedAt: string; status: string }[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  useEffect(() => {
    setLogLoading(true);
    fetch(`/api/aeo/autopilot-log?siteId=${siteId}`)
      .then(r => r.ok ? r.json() : { entries: [] })
      .then(d => setFixLog(d.entries ?? []))
      .catch(() => {})
      .finally(() => setLogLoading(false));
  }, [siteId]);

  const handleSave = async () => {
    setSaving(true);
    await updateAutopilotConfig(siteId, enabled, schedule, digestEnabled);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleGenerateBadge = async () => {
    setGeneratingBadge(true);
    const res = await generatePublicBadgeToken(siteId);
    if (res.success && res.token) setBadgeToken(res.token);
    setGeneratingBadge(false);
  };

  const badgeUrl = badgeToken ? `${siteUrl}/api/aeo/badge?token=${badgeToken}` : null;
  const embedCode = badgeUrl ? `<img src="${badgeUrl}" alt="AEO Score" width="200" height="64">` : null;

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-violet-400" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">AEO Autopilot</p>
              <p className="text-xs text-muted-foreground">Auto-runs AEO checks on a schedule</p>
            </div>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="Toggle AEO autopilot"
            onClick={() => setEnabled((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${enabled ? "bg-violet-500" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${enabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>

        {enabled && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {SCHEDULES.map((s) => (
              <button
                key={s.value}
                onClick={() => setSchedule(s.value)}
                aria-pressed={schedule === s.value}
                aria-label={`Set schedule to ${s.label}`}
                className={`p-3 rounded-xl border text-left transition-colors ${
                  schedule === s.value
                    ? "border-violet-500/50 bg-violet-500/10"
                    : "border-border hover:border-violet-500/20 hover:bg-accent"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs font-bold text-foreground">{s.label}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{s.desc}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-5 rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Mail className="w-4 h-4 text-emerald-400" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Weekly digest email</p>
              <p className="text-xs text-muted-foreground">Score, gSOV delta, and top fix — every Monday</p>
            </div>
          </div>
          <button
            role="switch"
            aria-checked={digestEnabled}
            aria-label="Toggle weekly digest email"
            onClick={() => setDigestEnabled((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${digestEnabled ? "bg-emerald-500" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${digestEnabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
      </div>

      <div className="p-5 rounded-2xl border border-border bg-card">
        <p className="text-sm font-bold text-foreground mb-1">Public AEO Score Badge</p>
        <p className="text-xs text-muted-foreground mb-4">Embed a live score badge in proposals, portfolios, and reports.</p>

        {badgeUrl ? (
          <div className="space-y-3">
            <img src={badgeUrl} alt="AEO Score Badge" width={200} height={64} className="rounded-lg" />
            <div className="p-3 bg-muted/40 rounded-xl">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Embed code</p>
              <code className="text-xs font-mono text-foreground break-all">{embedCode}</code>
            </div>
            <button
              onClick={handleGenerateBadge}
              disabled={generatingBadge}
              aria-label="Regenerate badge token"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Regenerate token
            </button>
          </div>
        ) : (
          <button
            onClick={handleGenerateBadge}
            disabled={generatingBadge}
            aria-label="Generate AEO badge"
            className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-accent transition-colors disabled:opacity-50"
          >
            {generatingBadge ? "Generating…" : "Generate badge"}
          </button>
        )}
      </div>

      <div className="p-5 rounded-2xl border border-border bg-card">
        <p className="text-sm font-bold text-foreground mb-1">Autopilot Fix Log</p>
        <p className="text-xs text-muted-foreground mb-4">Recent automated actions applied to your site.</p>
        {logLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
            Loading log…
          </div>
        ) : fixLog.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic">No automated fixes applied yet. Enable Autopilot above to get started.</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {fixLog.map((entry, i) => (
              <div key={i} className="flex items-start gap-2.5 text-xs px-3 py-2.5 rounded-xl border border-border bg-muted/20">
                <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${entry.status === "applied" ? "bg-emerald-400" : entry.status === "failed" ? "bg-rose-400" : "bg-amber-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{entry.action}</p>
                  <p className="text-muted-foreground/60 text-[10px] mt-0.5">{new Date(entry.appliedAt).toLocaleString()}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  entry.status === "applied" ? "bg-emerald-500/10 text-emerald-400" :
                  entry.status === "failed" ? "bg-rose-500/10 text-rose-400" :
                  "bg-amber-500/10 text-amber-400"
                }`}>{entry.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        aria-label="Save autopilot settings"
        className="w-full h-10 rounded-xl bg-foreground text-background text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50"
      >
        {saved ? "Saved ✓" : saving ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}
