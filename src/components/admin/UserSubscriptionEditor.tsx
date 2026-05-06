"use client";
import { useState } from "react";
import { ChevronDown, Check, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

const TIERS = ["FREE", "STARTER", "PRO", "AGENCY"] as const;
type Tier = (typeof TIERS)[number];

const TIER_RANK: Record<Tier, number> = {
  FREE: 0, STARTER: 1, PRO: 2, AGENCY: 3,
};

const TIER_COLORS: Record<Tier, string> = {
  FREE:    "admin-tier-free",
  STARTER: "admin-tier-pro",   // reuse pro style for starter
  PRO:     "admin-tier-pro",
  AGENCY:  "admin-tier-agency",
};

const TIER_CREDITS: Record<Tier, number> = {
  FREE: 50, STARTER: 150, PRO: 500, AGENCY: 2000,
};

const TIER_AUDITS: Record<Tier, number> = {
  FREE: 3, STARTER: 10, PRO: 50, AGENCY: 500,
};

interface UserSubscriptionEditorProps {
  userId: string;
  currentTier: Tier;
  onUpdate?: (newTier: Tier) => void;
}

export function UserSubscriptionEditor({
  userId,
  currentTier,
  onUpdate,
}: UserSubscriptionEditorProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Tier>(currentTier);
  const [saving, setSaving] = useState(false);

  const handleSelect = async (tier: Tier) => {
    // Silently close if same tier
    if (tier === selected) { setOpen(false); return; }

    // Prevent downgrade in the UI before even hitting the API
    if (TIER_RANK[tier] < TIER_RANK[selected]) {
      toast.error(`Cannot downgrade from ${selected} to ${tier}. Use the billing cancellation flow.`);
      setOpen(false);
      return;
    }

    setSaving(true);
    setOpen(false);

    try {
      const res = await fetch(`/api/admin/users/${userId}/subscription`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error ?? "Failed to update subscription tier");
        return;
      }

      setSelected(tier);
      onUpdate?.(tier);
      toast.success(json.message ?? `Tier updated to ${tier}`);
    } catch {
      toast.error("Network error — failed to update subscription tier");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        id={`tier-editor-${userId}`}
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className={`admin-tier-badge ${TIER_COLORS[selected]} flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity`}
      >
        {saving ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <>
            <span>{selected}</span>
            <ChevronDown className="w-3 h-3" />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 admin-dropdown z-50 rounded-xl py-1 min-w-[180px] shadow-2xl">
            <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/30">
              Upgrade to
            </p>
            {TIERS.map((tier) => {
              const isCurrentOrLower = TIER_RANK[tier] <= TIER_RANK[selected];
              return (
                <button
                  key={tier}
                  onClick={() => handleSelect(tier)}
                  disabled={isCurrentOrLower}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold transition-colors
                    ${tier === selected
                      ? "text-emerald-400 cursor-default"
                      : isCurrentOrLower
                        ? "text-white/20 cursor-not-allowed"
                        : "text-white/80 hover:bg-white/10"
                    }`}
                >
                  <span className="flex items-center gap-2">
                    {isCurrentOrLower && tier !== selected && (
                      <Lock className="w-2.5 h-2.5 text-white/20" />
                    )}
                    {tier}
                    {tier !== selected && !isCurrentOrLower && (
                      <span className="text-[9px] text-white/30 font-normal">
                        {TIER_CREDITS[tier]} credits · {TIER_AUDITS[tier]} audits/mo
                      </span>
                    )}
                  </span>
                  {tier === selected && <Check className="w-3 h-3 text-emerald-400" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
