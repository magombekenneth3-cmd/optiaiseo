"use client";

import { useState } from "react";
import { RotateCcw, Code2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface Props {
  userId: string;
}

export function SettingsClientExtras({ userId }: Props) {
  const [copied, setCopied] = useState(false);

  const embedSnippet = `<script src="https://optiaiseo.online/embed.js" data-user="${userId}" defer></script>`;

  async function handleCopyEmbed() {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopied(true);
      toast.success("Embed snippet copied!");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Copy failed — please copy manually.");
    }
  }

  function handleRestartTour() {
    localStorage.removeItem("optiaiseo_tour_done");
    localStorage.removeItem("optiaiseo_tour_dismissed");
    toast.success("Onboarding tour reset! Refresh the dashboard to restart it.");
  }

  return (
    <>
      {/* Onboarding Tour Re-trigger */}
      <div className="card-surface p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-accent border border-border flex items-center justify-center shrink-0">
            <RotateCcw className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold mb-1">Onboarding Tour</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Missed something during setup? Restart the interactive onboarding tour from the beginning.
            </p>
          </div>
        </div>
        <button
          onClick={handleRestartTour}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent text-sm font-semibold transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Restart tour
        </button>
      </div>

      {/* Embed Widget */}
      <div className="card-surface p-6 flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-accent border border-border flex items-center justify-center shrink-0">
            <Code2 className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold mb-1">Embed Widget</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Add this one-line snippet to any page to display a live SEO score badge for your site.
            </p>
            <div className="relative group">
              <pre className="bg-muted border border-border rounded-xl px-4 py-3 text-xs text-muted-foreground overflow-x-auto font-mono select-all">
                {embedSnippet}
              </pre>
              <button
                onClick={handleCopyEmbed}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-background border border-border hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
                aria-label="Copy embed snippet"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-brand" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
