"use client";

import React, { useState, useEffect } from "react";
import { Mic, Code, GitPullRequest, Eye, CheckCircle2 } from "lucide-react";

export function AriaDemoInterface() {
  const [step, setStep] = useState(0);

  // Play an automated loop for the demo
  useEffect(() => {
    const timer = setInterval(() => {
      setStep((s) => (s < 4 ? s + 1 : 0));
    }, 4500); // 4.5s per step
    return () => clearInterval(timer);
  }, []);

  const messages = [
    {
      role: "user",
      text: "Aria, why is our pricing page dropping in AI search?",
      time: 0,
    },
    {
      role: "aria",
      text: "Scanning...",
      isScanning: true,
      time: 1,
    },
    {
      role: "aria",
      text: "The pricing page is missing Product schema and has render-blocking scripts. I've drafted a fix.",
      action: "Created PR #142: Fix Pricing Schema",
      time: 2,
    },
    {
      role: "user",
      text: "Looks perfect, merge it.",
      time: 3,
    },
    {
      role: "aria",
      text: "Merged. Schema is live and validation requested in GSC.",
      isSuccess: true,
      time: 4,
    },
  ];

  const currentMessages = messages.filter((m) => m.time <= step);

  return (
    <div className="w-full max-w-2xl mx-auto rounded-2xl border border-border bg-card/60 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <Mic className="w-4 h-4 text-emerald-500" />
            {(step === 1 || step === 2 || step === 4) && (
              <span className="absolute inset-0 rounded-full border border-emerald-500/40 animate-ping" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground leading-none">Aria Voice Copilot</h3>
            <p className="text-[11px] text-emerald-500 font-medium mt-1">Listening (Sub-second latency)</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-border" />
          <div className="w-3 h-3 rounded-full bg-border" />
          <div className="w-3 h-3 rounded-full bg-border" />
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 p-5 overflow-y-auto space-y-4 min-h-[300px] flex flex-col justify-end">
        {currentMessages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-4 duration-300 ${
              msg.role === "user" ? "self-end items-end" : "self-start items-start"
            }`}
          >
            <div
              className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-foreground text-background rounded-br-sm"
                  : "bg-muted text-foreground border border-border rounded-bl-sm"
              }`}
            >
              {msg.isScanning ? (
                <div className="flex items-center gap-2 text-muted-foreground italic">
                  <Eye className="w-4 h-4 animate-pulse" /> Scanning live DOM & Core Web Vitals...
                </div>
              ) : (
                msg.text
              )}
            </div>

            {/* Action Cards (Aria only) */}
            {msg.action && (
              <div className="mt-2 ml-2 bg-background border border-border rounded-xl p-3 flex items-center gap-3 shadow-sm w-full max-w-[280px]">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <GitPullRequest className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{msg.action}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Code className="w-3 h-3" /> Auto-fix generated
                  </p>
                </div>
              </div>
            )}

            {msg.isSuccess && (
              <div className="mt-2 ml-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4" /> Production deployment
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Waveform Footer */}
      <div className="h-20 border-t border-border bg-muted/10 px-6 flex items-center justify-center gap-1 shrink-0 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-r from-card via-transparent to-card z-10" />
        {[...Array(40)].map((_, i) => {
          // Animate height based on whose turn it is
          const isUserSpoke = step === 0 || step === 3;
          const isAriaSpoke = step === 1 || step === 2 || step === 4;
          const isActive = isUserSpoke || isAriaSpoke;
          
          // Randomize heights slightly, but make them pulse if active
          const h = isActive ? Math.random() * 24 + 8 : 4;
          const color = isAriaSpoke ? "bg-emerald-500" : isUserSpoke ? "bg-foreground" : "bg-muted-foreground/30";
          
          return (
            <div
              key={i}
              className={`w-1.5 rounded-full transition-all duration-150 ease-out ${color}`}
              style={{
                height: `${h}px`,
                opacity: isActive ? 0.8 : 0.3,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
