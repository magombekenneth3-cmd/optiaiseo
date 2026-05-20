import { useState, useEffect } from "react";
import type { CreditAction } from "@/lib/credits/constants";

// Simple client-side cache to mimic SWR deduping/caching
const cache: Record<string, { data: any; timestamp: number }> = {};

export function useCreditCheck(action: CreditAction) {
  const cacheKey = `/api/credits/check?action=${action}`;
  const now = Date.now();

  const [state, setState] = useState<{ data: any; isLoading: boolean }>(() => {
    const cached = cache[cacheKey];
    if (cached && now - cached.timestamp < 30_000) {
      return { data: cached.data, isLoading: false };
    }
    return { data: null, isLoading: true };
  });

  useEffect(() => {
    let active = true;
    const nowCheck = Date.now();
    const cachedEntry = cache[cacheKey];
    if (cachedEntry && nowCheck - cachedEntry.timestamp < 30_000) {
      setState({ data: cachedEntry.data, isLoading: false });
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true }));
    fetch(cacheKey)
      .then((r) => r.json())
      .then((res) => {
        if (!active) return;
        cache[cacheKey] = { data: res, timestamp: Date.now() };
        setState({ data: res, isLoading: false });
      })
      .catch(() => {
        if (!active) return;
        setState({ data: null, isLoading: false });
      });

    return () => {
      active = false;
    };
  }, [cacheKey]);

  return {
    remaining: state.data?.remaining ?? 0,
    cost: state.data?.cost ?? 0,
    canAfford: state.data?.canAfford ?? true, // optimistic default
    locked: state.data?.locked ?? false,
    actionLabel: state.data?.actionLabel ?? null,
    isLoading: state.isLoading,
  };
}
