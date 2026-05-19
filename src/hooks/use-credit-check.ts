import useSWR from "swr";
import type { CreditAction } from "@/lib/credits/constants";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useCreditCheck(action: CreditAction) {
  const { data, isLoading } = useSWR(
    `/api/credits/check?action=${action}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30_000,   // cache for 30s
    }
  );

  return {
    remaining: data?.remaining ?? 0,
    cost: data?.cost ?? 0,
    canAfford: data?.canAfford ?? true, // optimistic default
    locked: data?.locked ?? false,
    actionLabel: data?.actionLabel ?? null,
    isLoading,
  };
}
