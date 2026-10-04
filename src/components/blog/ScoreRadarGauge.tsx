"use client";

import { useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Sparkles, Copy, Check, BarChart2, BookOpen, Layers, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

export interface ScoreRadarGaugeProps {
  score: number | null;
  label?: string;
  size?: "sm" | "md" | "lg";
  subScores?: {
    wordCount?: { current: number; targetMin: number; targetMax: number };
    exactKeywords?: { current: number; targetMin: number; targetMax: number };
    nlpTerms?: { covered: string[]; missing: string[] };
    headings?: { covered: string[]; missing: string[] };
    readability?: { gradeLevel: number };
  };
  imageRecommendation?: { current: number; targetMin: number; targetMax: number };
  topOpportunities?: string[];
  onInsertTerm?: (term: string) => void;
}

function getTone(score: number | null) {
  if (score == null) return { text: "text-muted-foreground", stroke: "#71717a", bg: "bg-zinc-500/10", border: "border-zinc-500/20", label: "Unanalyzed" };
  if (score >= 80) return { text: "text-emerald-400", stroke: "#10b981", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Excellent (Ready)" };
  if (score >= 60) return { text: "text-amber-400", stroke: "#f59e0b", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Needs Minor Work" };
  return { text: "text-rose-400", stroke: "#f43f5e", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Needs Optimization" };
}

export function ScoreRadarGauge({
  score,
  label = "Content Score",
  size = "md",
  subScores,
  imageRecommendation,
  topOpportunities,
  onInsertTerm,
}: ScoreRadarGaugeProps) {
  const [activeTab, setActiveTab] = useState<"terms" | "metrics" | "actions">("terms");
  const [termFilter, setTermFilter] = useState<"all" | "missing" | "covered">("missing");
  const [copiedTerm, setCopiedTerm] = useState<string | null>(null);

  const tone = getTone(score);
  const displayScore = score != null ? Math.min(100, Math.max(0, score)) : 0;

  // SVG Radial Math
  const radius = size === "lg" ? 48 : size === "sm" ? 28 : 38;
  const strokeWidth = size === "lg" ? 8 : size === "sm" ? 5 : 6.5;
  const normalizedRadius = radius - strokeWidth / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (displayScore / 100) * circumference;

  const handleTermClick = (term: string) => {
    if (onInsertTerm) {
      onInsertTerm(term);
      toast.success(`Inserted term: "${term}"`);
    } else {
      navigator.clipboard.writeText(term);
      setCopiedTerm(term);
      toast.success(`Copied "${term}" to clipboard`);
      setTimeout(() => setCopiedTerm(null), 2000);
    }
  };

  const missingNlp = subScores?.nlpTerms?.missing ?? [];
  const coveredNlp = subScores?.nlpTerms?.covered ?? [];

  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 p-5 backdrop-blur-xl shadow-2xl space-y-5">
      {/* Header Radial Gauge */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative flex items-center justify-center">
            <svg
              height={radius * 2}
              width={radius * 2}
              className="-rotate-90 transform drop-shadow-[0_0_12px_rgba(16,185,129,0.2)]"
            >
              <circle
                stroke="rgba(255, 255, 255, 0.08)"
                fill="transparent"
                strokeWidth={strokeWidth}
                r={normalizedRadius}
                cx={radius}
                cy={radius}
              />
              <circle
                stroke={tone.stroke}
                fill="transparent"
                strokeWidth={strokeWidth}
                strokeDasharray={`${circumference} ${circumference}`}
                style={{ strokeDashoffset }}
                strokeLinecap="round"
                r={normalizedRadius}
                cx={radius}
                cy={radius}
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className={`font-mono font-bold tracking-tight ${size === "lg" ? "text-2xl" : "text-xl"} ${tone.text}`}>
                {score ?? "—"}
              </span>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">{label}</h4>
            <div className={`mt-1 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${tone.bg} ${tone.border} ${tone.text}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {tone.label}
            </div>
          </div>
        </div>

        {subScores && (
          <div className="hidden sm:flex items-center gap-4 text-right">
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase">NLP Terms</p>
              <p className="text-xs font-bold text-foreground">
                {coveredNlp.length}/{coveredNlp.length + missingNlp.length}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Word Count</p>
              <p className="text-xs font-bold text-foreground">
                {subScores.wordCount?.current ?? 0} <span className="text-[10px] font-normal text-muted-foreground">/ {subScores.wordCount?.targetMin ?? "—"}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      {subScores && (
        <div className="space-y-4">
          <div className="flex border-b border-white/10 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("terms")}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors ${
                activeTab === "terms" ? "border-emerald-500 text-emerald-400" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              NLP Terms ({missingNlp.length} missing)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("metrics")}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors ${
                activeTab === "metrics" ? "border-emerald-500 text-emerald-400" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <BarChart2 className="h-3.5 w-3.5" />
              SERP Metrics
            </button>
            {topOpportunities && topOpportunities.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab("actions")}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors ${
                  activeTab === "actions" ? "border-emerald-500 text-emerald-400" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <AlertCircle className="h-3.5 w-3.5" />
                Opportunities ({topOpportunities.length})
              </button>
            )}
          </div>

          {/* Tab 1: Surfer NLP Terms Grid */}
          {activeTab === "terms" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex gap-1 bg-muted/30 p-1 rounded-lg border border-white/5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setTermFilter("missing")}
                    className={`px-2 py-0.5 rounded ${termFilter === "missing" ? "bg-emerald-500/20 text-emerald-400 font-semibold" : "text-muted-foreground"}`}
                  >
                    Missing ({missingNlp.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTermFilter("covered")}
                    className={`px-2 py-0.5 rounded ${termFilter === "covered" ? "bg-emerald-500/20 text-emerald-400 font-semibold" : "text-muted-foreground"}`}
                  >
                    Covered ({coveredNlp.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTermFilter("all")}
                    className={`px-2 py-0.5 rounded ${termFilter === "all" ? "bg-emerald-500/20 text-emerald-400 font-semibold" : "text-muted-foreground"}`}
                  >
                    All ({missingNlp.length + coveredNlp.length})
                  </button>
                </div>
                <span className="text-[10px] text-muted-foreground">Click term to insert/copy</span>
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-1 pr-2">
                {(termFilter === "missing" || termFilter === "all") &&
                  missingNlp.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => handleTermClick(term)}
                      className="group flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-1 text-xs font-medium text-rose-300 transition-all hover:border-rose-500/40 hover:bg-rose-500/10"
                    >
                      <span>{term}</span>
                      <span className="text-[10px] text-rose-400/60 group-hover:text-rose-300">
                        {copiedTerm === term ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </span>
                    </button>
                  ))}

                {(termFilter === "covered" || termFilter === "all") &&
                  coveredNlp.map((term) => (
                    <span
                      key={term}
                      className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 text-xs font-medium text-emerald-300"
                    >
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      {term}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Tab 2: SERP Benchmark Metrics */}
          {activeTab === "metrics" && (
            <div className="space-y-3 text-xs">
              <div className="space-y-1.5">
                <div className="flex justify-between font-medium">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5 text-emerald-400" /> Word Count
                  </span>
                  <span>
                    <strong className="text-foreground">{subScores.wordCount?.current ?? 0}</strong> / {subScores.wordCount?.targetMin ?? 0}–{subScores.wordCount?.targetMax ?? 0}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        ((subScores.wordCount?.current ?? 0) / (subScores.wordCount?.targetMin || 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between font-medium">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Layers className="h-3.5 w-3.5 text-blue-400" /> Target Keyword Uses
                  </span>
                  <span>
                    <strong className="text-foreground">{subScores.exactKeywords?.current ?? 0}</strong> / {subScores.exactKeywords?.targetMin ?? 0} median
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        ((subScores.exactKeywords?.current ?? 0) / (subScores.exactKeywords?.targetMin || 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {imageRecommendation && (
                <div className="space-y-1.5">
                  <div className="flex justify-between font-medium">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <ImageIcon className="h-3.5 w-3.5 text-amber-400" /> Image Density
                    </span>
                    <span>
                      <strong className="text-foreground">{imageRecommendation.current}</strong> / {imageRecommendation.targetMin}–{imageRecommendation.targetMax}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Opportunities */}
          {activeTab === "actions" && topOpportunities && (
            <div className="space-y-2 text-xs">
              {topOpportunities.map((opp, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{opp}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
