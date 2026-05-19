"use client";
import { useCreditCheck } from "@/hooks/use-credit-check";
import type { CreditAction } from "@/lib/credits/constants";
import { Coins } from "lucide-react";
import Link from "next/link";
import React from "react";

interface CreditGateProps {
  action: CreditAction;
  children: React.ReactNode;
}

export function CreditGate({ action, children }: CreditGateProps) {
  const { remaining, cost, canAfford, locked, isLoading } = useCreditCheck(action);

  // While loading, render children optimistically (server will 402 if needed)
  if (isLoading) return <>{children}</>;

  if (locked) {
    return (
      <div className="space-y-1">
        <div className="pointer-events-none opacity-40 select-none">{children}</div>
        <p className="text-xs text-amber-400 flex items-center gap-1.5">
          <Coins size={11} />
          Credits locked —{" "}
          <Link href="/dashboard/billing" className="underline hover:text-amber-300">
            renew plan
          </Link>
        </p>
      </div>
    );
  }

  if (!canAfford) {
    return (
      <div className="space-y-1">
        <div className="pointer-events-none opacity-40 select-none">{children}</div>
        <p className="text-xs text-rose-400 flex items-center gap-1.5">
          <Coins size={11} />
          Costs {cost} credits · you have {remaining} ·{" "}
          <Link href="/dashboard/billing" className="underline hover:text-rose-300">
            top up
          </Link>
        </p>
      </div>
    );
  }

  // Can afford — show children with subtle cost badge on hover
  return (
    <div className="relative group">
      {children}
      {cost > 0 && (
        <span className="absolute -top-5 right-0 text-[10px] text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap bg-background border border-border px-1.5 py-0.5 rounded shadow-sm">
          {cost} credit{cost !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
