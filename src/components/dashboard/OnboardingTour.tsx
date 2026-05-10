"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { markOnboardingDone } from "@/app/actions/onboarding";
import { useFocusTrap } from "@/hooks/use-focus-trap";

const STORAGE_KEY = "aiseo_tour_dismissed";
const INLINE_DONE_KEY = "aiseo_inline_complete";


function DomainIllustration() {
  return (
    <div className="w-full max-w-xs mx-auto">
      <div className="rounded-xl border border-border bg-muted/60 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/40">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
          </div>
          <div className="flex-1 bg-muted/60 rounded-md px-3 py-1 text-[11px] text-muted-foreground font-mono">
            yourdomain.com
          </div>
        </div>
        <div className="p-4 flex items-center gap-3">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-indigo-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <div className="flex-1">
            <div className="text-sm font-semibold text-foreground">yourdomain.com</div>
            <div className="text-[11px] text-muted-foreground">All features ready</div>
          </div>
          <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditScoreIllustration() {
  const score = 73;
  const r = 38;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="flex items-center justify-center gap-6">
      <div className="relative w-28 h-28 flex items-center justify-center">
        <svg viewBox="0 0 100 100" className="w-28 h-28 -rotate-90 absolute inset-0">
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          <circle cx="50" cy="50" r={r} fill="none" stroke="#f59e0b" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`} />
        </svg>
        <div className="relative text-center">
          <div className="text-2xl font-black text-foreground">{score}</div>
          <div className="text-[10px] text-muted-foreground -mt-0.5">/100</div>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        {[
          { label: "Core Web Vitals", ok: true },
          { label: "Meta Tags", ok: true },
          { label: "Schema Markup", ok: false },
          { label: "Internal Links", ok: false },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${item.ok ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
              {item.ok ? "✓" : "✗"}
            </span>
            <span className="text-muted-foreground text-xs">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AeoIllustration() {
  return (
    <div className="w-full max-w-xs mx-auto flex flex-col gap-2">
      {[
        { query: "best fiber internet in Uganda", brand: "Your Brand", mentioned: true },
        { query: "fastest ISP Kampala", brand: "Competitor ISP", mentioned: false },
      ].map((row, i) => (
        <div key={i} className="rounded-xl border border-border/50 bg-muted/60 p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-muted-foreground mb-0.5 truncate">&quot;{row.query}&quot;</div>
            <div className="text-xs font-semibold text-foreground">{row.brand}</div>
          </div>
          {row.mentioned ? (
            <span className="shrink-0 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-[11px] font-bold">
              Mentioned ✓
            </span>
          ) : (
            <span className="shrink-0 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-bold">
              Not Mentioned
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function BlogIllustration() {
  return (
    <div className="w-full max-w-xs mx-auto rounded-xl border border-border bg-muted/60 p-4 font-mono text-xs">
      <div className="h-3 w-3/4 rounded bg-muted-foreground/20 mb-3" />
      <div className="h-2 w-full rounded bg-muted-foreground/10 mb-1.5" />
      <div className="h-2 w-5/6 rounded bg-muted-foreground/10 mb-3" />
      <div className="h-2.5 w-1/2 rounded bg-indigo-400/30 mb-2" />
      <div className="h-2 w-full rounded bg-muted-foreground/10 mb-1.5" />
      <div className="h-2 w-4/5 rounded bg-muted-foreground/10 mb-4" />
      <div className="flex justify-end">
        <div className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-[11px] font-semibold">
          Generate →
        </div>
      </div>
    </div>
  );
}

function VoiceIllustration() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <div className="w-16 h-16 rounded-full bg-indigo-500/15 border-2 border-indigo-500/30 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-indigo-400" fill="currentColor">
            <path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4zm0 2a2 2 0 0 1 2 2v7a2 2 0 0 1-4 0V5a2 2 0 0 1 2-2zm7 9a1 1 0 0 0-1 1 6 6 0 0 1-12 0 1 1 0 0 0-2 0 8 8 0 0 0 7 7.93V22h-2a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.07A8 8 0 0 0 20 13a1 1 0 0 0-1-1z" />
          </svg>
        </div>
        {/* Pulse rings */}
        <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20 animate-ping" style={{ animationDuration: "2s" }} />
      </div>
      <div className="rounded-2xl rounded-bl-sm bg-muted/80 border border-border/50 px-4 py-2.5 text-xs text-muted-foreground max-w-[220px] text-center">
        &quot;Why is my homepage not ranking?&quot;
      </div>
      {/* Waveform bars */}
      <div className="flex items-center gap-1 h-6">
        {[3, 7, 5, 9, 4, 8, 5, 3, 7, 6, 4, 9, 3].map((h, i) => (
          <div
            key={i}
            className="w-1 rounded-full bg-indigo-400/60"
            style={{ height: `${h * 2.5}px`, animationDelay: `${i * 0.08}s` }}
          />
        ))}
      </div>
    </div>
  );
}


interface Step {
  icon: string;
  title: string;
  body: string;
  illustration?: React.ReactNode;
  primaryLabel: string;
}

const STEPS: Step[] = [
  {
    icon: "✨",
    title: "Welcome to OptiAISEO",
    body: "OptiAISEO tracks your visibility in Google AND in AI search engines like ChatGPT, Perplexity, and Gemini — all in one dashboard. This quick tour takes 60 seconds.",
    primaryLabel: "Start Tour →",
  },
  {
    icon: "🌐",
    title: "Add Your Website First",
    body: "Everything in OptiAISEO is organized around your website. Go to My Domains in the sidebar and add your domain. Once added, all features activate for that site.",
    illustration: <DomainIllustration />,
    primaryLabel: "Next →",
  },
  {
    icon: "🔍",
    title: "Your first audit is already running",
    body: "OptiAISEO queued your first crawl automatically when you added your site. Go to SEO Audits to see your results — Core Web Vitals, meta tags, heading structure, schema markup, and more. It takes about 30–60 seconds to complete.",
    illustration: <AuditScoreIllustration />,
    primaryLabel: "Next →",
  },
  {
    icon: "🤖",
    title: "See If AI Engines Recommend You",
    body: "Go to AEO Tracking and click Run Daily Check. OptiAISEO asks Gemini the keywords you care about and checks if your brand gets mentioned. If competitors appear instead of you, each result shows exactly what to fix.",
    illustration: <AeoIllustration />,
    primaryLabel: "Next →",
  },
  {
    icon: "✍️",
    title: "Generate Blog Posts That Rank",
    body: "Go to AI Content and click Generate Blog. OptiAISEO writes a 2500-word SEO-optimized post targeting your weakest keyword gaps, complete with schema markup, FAQs, and internal links. You review and publish.",
    illustration: <BlogIllustration />,
    primaryLabel: "Next →",
  },
  {
    icon: "🎙️",
    title: "Ask Aria Anything",
    body: "Go to AI Voice Agent and click the microphone. Aria is your AI SEO strategist — ask her to walk you through your audit results, explain a keyword, or find what competitors are ranking for. She answers in real time with voice.",
    illustration: <VoiceIllustration />,
    primaryLabel: "Finish Tour ✓",
  },
];


export function OnboardingTour({ onboardingDone }: { onboardingDone: boolean }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, visible);

  useEffect(() => {
    if (onboardingDone) return;
    try {
      // Don't fire tour while the inline wizard is still active.
      // The inline wizard sets 'aiseo_inline_complete' when the user
      // finishes or skips it — only then do we show the full tour.
      if (!localStorage.getItem(INLINE_DONE_KEY)) return;
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch { /* SSR / private mode */ }
    // Small delay so the page renders first
    const t = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(t);
  }, [onboardingDone]);

  const dismiss = useCallback(async (persist = true) => {
    setExiting(true);
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { }
    if (persist) await markOnboardingDone();
    setTimeout(() => { setVisible(false); setExiting(false); }, 250);
  }, []);

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss(true);
    }
  }, [step, dismiss]);

  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // Keyboard nav
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss(true);
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, dismiss, next, prev]);


  if (!visible) return null;

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        backgroundColor: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        animation: exiting ? "fadeOut 0.25s ease forwards" : "fadeIn 0.25s ease forwards",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(true); }}
    >
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
          @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        }
      `}</style>

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        aria-describedby="tour-step-body"
        tabIndex={-1}
        className="relative w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl shadow-black/60 overflow-hidden focus:outline-none"
        style={{ animation: "slideUp 0.3s cubic-bezier(0.16,1,0.3,1) forwards" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gradient accent bar */}
        <div
          className="absolute top-0 left-0 right-0 h-0.5"
          style={{ background: "linear-gradient(90deg, #6366f1, #8b5cf6, #6366f1)", backgroundSize: "200% 100%", animation: "slideRight 3s linear infinite" }}
        />

        {/* Top bar */}
        <div className="flex items-center justify-between px-6 pt-5 pb-1">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center">
              <span className="font-black text-foreground text-[9px]">AI</span>
            </div>
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">OptiAISEO Setup</span>
          </div>
          <button
            onClick={() => dismiss(true)}
            aria-label="Skip tour"
            className="text-muted-foreground hover:text-foreground text-xs transition-colors px-2 py-1 rounded-lg hover:bg-muted"
          >
            Skip tour
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 min-h-[340px] flex flex-col">
          {/* Icon + title */}
          <div className="flex flex-col items-center text-center mb-5">
            <div
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/20 flex items-center justify-center text-3xl mb-4 shadow-lg shadow-indigo-500/10"
              style={{ animation: "none" }}
            >
              {current.icon}
            </div>
            <h2 id="tour-step-title" className="text-xl font-bold text-foreground mb-2 tracking-tight">{current.title}</h2>
            <p id="tour-step-body" className="text-muted-foreground text-sm leading-relaxed max-w-lg">{current.body}</p>
          </div>

          {/* Illustration */}
          {current.illustration && (
            <div className="flex-1 flex items-center justify-center py-2">
              {current.illustration}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center gap-4">
          {/* Back */}
          <div className="w-20">
            {!isFirst && (
              <button
                onClick={prev}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 transition-all"
              >
                ← Back
              </button>
            )}
          </div>

          {/* Dots */}
          <div className="flex-1 flex items-center justify-center gap-2">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1} of ${STEPS.length}: ${STEPS[i].title}`}
                aria-current={i === step ? "step" : undefined}
                className="transition-all duration-300 rounded-full"
                style={{
                  width: i === step ? "20px" : "8px",
                  height: "8px",
                  background: i < step
                    ? "var(--muted-foreground)"
                    : i === step
                      ? "var(--foreground)"
                      : "var(--border)",
                }}
              />
            ))}
          </div>

          {/* Next / Finish */}
          <div className="w-36 flex justify-end">
            <button
              onClick={next}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95"
              style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)" }}
            >
              {isLast ? "Finish Tour ✓" : isFirst ? "Start Tour →" : "Next →"}
            </button>
          </div>
        </div>

        {/* Step counter */}
        <div className="absolute top-5 right-16 text-[11px] text-muted-foreground/60 font-mono">
          {step + 1}/{STEPS.length}
        </div>
      </div>
    </div>
  );
}
