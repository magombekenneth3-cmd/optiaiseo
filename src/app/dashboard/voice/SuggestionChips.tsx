"use client";

import { Search, TrendingUp, FileText, Target } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
type ChipColor = "emerald" | "blue" | "indigo" | "purple" | "amber";

interface Chip {
  label: string;
  icon: React.ElementType;
  color: ChipColor;
}

// ─── Color map ─────────────────────────────────────────────────────────────────
const colorMap: Record<ChipColor, string> = {
  emerald:
    "bg-card/40 border-border text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)]",
  blue: 
    "bg-card/40 border-border text-blue-400 hover:bg-blue-500/10 hover:border-blue-500/30 hover:shadow-[0_0_15px_rgba(59,130,246,0.15)]",
  indigo:
    "bg-card/40 border-border text-indigo-400 hover:bg-indigo-500/10 hover:border-indigo-500/30 hover:shadow-[0_0_15px_rgba(99,102,241,0.15)]",
  purple:
    "bg-card/40 border-border text-purple-400 hover:bg-purple-500/10 hover:border-purple-500/30 hover:shadow-[0_0_15px_rgba(168,85,247,0.15)]",
  amber:
    "bg-card/40 border-border text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/30 hover:shadow-[0_0_15px_rgba(245,158,11,0.15)]",
};

// ─── Default chips ─────────────────────────────────────────────────────────────
const DEFAULT_CHIPS: Chip[] = [
  { label: "Audit my site", icon: Search, color: "emerald" },
  { label: "Find keyword gaps", icon: TrendingUp, color: "blue" },
  { label: "Analyze competitors", icon: Target, color: "indigo" },
  { label: "Generate blog ideas", icon: FileText, color: "purple" },
];

// ─── Component ─────────────────────────────────────────────────────────────────
interface SuggestionChipsProps {
  chips?: Chip[];
  onChipClick: (label: string) => void;
  className?: string;
  compact?: boolean;
}

export function SuggestionChips({
  chips = DEFAULT_CHIPS,
  onChipClick,
  className = "",
  compact = false,
}: SuggestionChipsProps) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {chips.map((chip, idx) => {
        const Icon = chip.icon;
        const colClass = colorMap[chip.color] ?? colorMap.indigo;
        return (
          <button
            key={chip.label}
            onClick={(e) => {
              // Ripple effect
              const btn = e.currentTarget;
              const ripple = document.createElement("span");
              ripple.className = "chip-ripple";
              ripple.style.left = `${e.nativeEvent.offsetX}px`;
              ripple.style.top = `${e.nativeEvent.offsetY}px`;
              btn.appendChild(ripple);
              setTimeout(() => ripple.remove(), 600);
              onChipClick(chip.label);
            }}
            className={`inline-flex items-center gap-2 px-4 ${compact ? "py-1.5" : "py-2.5"} rounded-xl border backdrop-blur-md text-[13px] font-medium transition-all duration-300 active:scale-95 ${colClass} chip-animate group`}
            style={{
              animation: `chipFadeIn 0.5s ${0.05 * idx}s both`,
              position: "relative",
              overflow: "hidden",
            }}
            aria-label={chip.label}
          >
            <span className="inline-flex items-center justify-center rounded-lg bg-card p-1.5 group-hover:bg-black/60 transition-colors">
              <Icon className="w-3.5 h-3.5 shrink-0" />
            </span>
            <span className="text-zinc-300 group-hover:text-white transition-colors">{chip.label}</span>
          </button>
        );
      })}
      <style>{`
                .chip-animate {
                    will-change: transform, opacity;
                }
                @keyframes chipFadeIn {
                    0% { opacity: 0; transform: translateY(12px) scale(0.95); }
                    100% { opacity: 1; transform: translateY(0) scale(1); }
                }
                .chip-ripple {
                    position: absolute;
                    width: 48px;
                    height: 48px;
                    background: rgba(255,255,255,0.18);
                    border-radius: 50%;
                    pointer-events: none;
                    transform: translate(-50%, -50%);
                    animation: chipRipple 0.6s linear;
                    z-index: 1;
                }
                @keyframes chipRipple {
                    0% { opacity: 0.5; transform: scale(0); }
                    100% { opacity: 0; transform: scale(2.2); }
                }
                .premium-icon-shadow {
                    box-shadow: 0 2px 8px 0 rgba(16,185,129,0.10), 0 1px 2px 0 rgba(59,130,246,0.08);
                }
            `}</style>
    </div>
  );
}

export { DEFAULT_CHIPS };
