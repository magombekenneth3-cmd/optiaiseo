"use client";

import { useEffect, useRef, useState } from "react";

interface NavSection {
  id: string;
  label: string;
  icon: string;
}

const SECTIONS: NavSection[] = [
  { id: "section-scores",   label: "Category Scores",  icon: "◈" },
  { id: "section-fixes",    label: "Priority Fixes",   icon: "⚡" },
  { id: "section-findings", label: "All Findings",     icon: "◎" },
  { id: "section-keywords", label: "Keyword Insights", icon: "◇" },
  { id: "section-pages",    label: "Page Audits",      icon: "⬡" },
];

export function AuditPageNav() {
  const [active, setActive] = useState<string>("");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const sectionEls = SECTIONS
      .map(s => document.getElementById(s.id))
      .filter(Boolean) as HTMLElement[];

    if (sectionEls.length === 0) return;

    const ratios = new Map<string, number>(sectionEls.map(el => [el.id, 0]));

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          ratios.set(entry.target.id, entry.intersectionRatio);
        });
        let best = "";
        let bestRatio = -1;
        ratios.forEach((ratio, id) => {
          if (ratio > bestRatio) { bestRatio = ratio; best = id; }
        });
        if (best) setActive(best);
      },
      { threshold: Array.from({ length: 11 }, (_, i) => i * 0.1) }
    );

    sectionEls.forEach(el => observerRef.current!.observe(el));

    return () => observerRef.current?.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  return (
    <nav
      aria-label="Audit report sections"
      className="hidden lg:flex flex-col gap-0.5 w-48 shrink-0 sticky top-8 self-start"
    >
      <p className="text-[9px] font-semibold text-zinc-600 uppercase tracking-[0.12em] px-3 pb-2 mb-1">
        On this page
      </p>

      {SECTIONS.map(section => {
        const isActive = active === section.id;
        return (
          <button
            key={section.id}
            onClick={() => scrollTo(section.id)}
            className={`
              group flex items-center gap-2.5 px-3 py-2 rounded-lg text-left w-full
              transition-all duration-150 text-[12px]
              ${isActive
                ? "bg-white/[0.06] text-foreground font-medium"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]"
              }
            `}
          >
            <span
              className={`shrink-0 w-0.5 h-4 rounded-full transition-all duration-200 ${
                isActive ? "bg-emerald-400" : "bg-transparent group-hover:bg-zinc-700"
              }`}
            />
            <span className="text-[11px] shrink-0 opacity-60">{section.icon}</span>
            <span className="truncate">{section.label}</span>
          </button>
        );
      })}

      <div className="mt-3 pt-3 border-t border-white/[0.06] px-3">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor">
            <path d="M6 9V3M3 6l3-3 3 3" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
          Back to top
        </button>
      </div>
    </nav>
  );
}
