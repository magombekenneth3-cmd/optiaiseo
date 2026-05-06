"use client";
import { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  delta?: number;
  deltaLabel?: string;
  accentClass?: string;
}

export function StatCard({
  label,
  value,
  icon,
  delta,
  deltaLabel,
  accentClass = "admin-accent-purple",
}: StatCardProps) {
  const hasDelta = delta !== undefined;
  const isPositive = hasDelta && delta > 0;
  const isNegative = hasDelta && delta < 0;
  const isNeutral = hasDelta && delta === 0;

  return (
    <div className="admin-stat-card rounded-2xl p-5 flex flex-col gap-3 hover:border-white/20 transition-all duration-300 group">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold tracking-widest uppercase text-white/40">
          {label}
        </p>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accentClass} shrink-0`}>
          {icon}
        </div>
      </div>

      <p className="text-3xl font-bold text-white tracking-tight">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>

      {hasDelta && (
        <div className="flex items-center gap-1.5">
          {isPositive && <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
          {isNegative && <TrendingDown className="w-3.5 h-3.5 text-rose-400" />}
          {isNeutral && <Minus className="w-3.5 h-3.5 text-white/30" />}
          <span
            className={`text-xs font-semibold ${
              isPositive ? "text-emerald-400" : isNegative ? "text-rose-400" : "text-white/30"
            }`}
          >
            {isPositive ? "+" : ""}
            {delta}
            {deltaLabel ? ` ${deltaLabel}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
