"use client";

/**
 * GSC Date Range Picker — URL-driven date range selector.
 *
 * Only responsibility: selection → URL.
 * The server page owns: URL → data.
 *
 * Supports preset ranges (7d/28d/90d/1y) and custom date inputs.
 * URL canonicalization: presets use `?days=N`, custom uses `?startDate=...&endDate=...`.
 * Never both.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useCallback, useTransition } from "react";
import { Calendar } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GscDateRangePickerProps {
    /** Current active date label from the server */
    activeLabel: string;
    /** Site ID to preserve in URL */
    siteId?: string;
}

interface PresetOption {
    label: string;
    days: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESETS: PresetOption[] = [
    { label: "7 days", days: 7 },
    { label: "28 days", days: 28 },
    { label: "90 days", days: 90 },
    { label: "1 year", days: 365 },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function GscDateRangePicker({ activeLabel, siteId }: GscDateRangePickerProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    const [showCustom, setShowCustom] = useState(false);
    const [customStart, setCustomStart] = useState("");
    const [customEnd, setCustomEnd] = useState("");

    // Determine which preset is active
    const activeDays = searchParams.get("days");
    const hasCustomRange = searchParams.has("startDate") && searchParams.has("endDate");

    const buildUrl = useCallback(
        (params: Record<string, string>) => {
            const newParams = new URLSearchParams();
            // Preserve siteId
            if (siteId) newParams.set("siteId", siteId);
            // Add new params
            for (const [key, value] of Object.entries(params)) {
                newParams.set(key, value);
            }
            return `${pathname}?${newParams.toString()}`;
        },
        [pathname, siteId],
    );

    const handlePreset = useCallback(
        (days: number) => {
            setShowCustom(false);
            startTransition(() => {
                router.push(buildUrl({ days: String(days) }));
            });
        },
        [router, buildUrl],
    );

    const handleCustomApply = useCallback(() => {
        if (!customStart || !customEnd) return;

        // Client-side validation
        if (customStart >= customEnd) return;

        startTransition(() => {
            router.push(
                buildUrl({ startDate: customStart, endDate: customEnd }),
            );
        });
        setShowCustom(false);
    }, [customStart, customEnd, router, buildUrl]);

    // Max date for inputs: today minus 3 days (GSC lag)
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() - 3);
    const maxDateStr = maxDate.toISOString().slice(0, 10);

    // Min date: 16 months ago
    const minDate = new Date();
    minDate.setMonth(minDate.getMonth() - 16);
    const minDateStr = minDate.toISOString().slice(0, 10);

    return (
        <div className="flex flex-col gap-2">
            {/* Preset buttons */}
            <div className="flex items-center gap-1.5 flex-wrap">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium text-muted-foreground mr-1">
                    Date range
                </span>

                {PRESETS.map((preset) => {
                    const isActive =
                        !hasCustomRange &&
                        (activeDays === String(preset.days) ||
                            (!activeDays && preset.days === 90));

                    return (
                        <button
                            key={preset.days}
                            onClick={() => handlePreset(preset.days)}
                            disabled={isPending}
                            className={`
                                px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150
                                ${
                                    isActive
                                        ? "bg-info/15 text-info border border-info/30"
                                        : "bg-muted text-muted-foreground border border-border hover:border-border hover:text-foreground"
                                }
                                ${isPending ? "opacity-50 cursor-wait" : "cursor-pointer"}
                            `}
                        >
                            {preset.label}
                        </button>
                    );
                })}

                <button
                    onClick={() => setShowCustom(!showCustom)}
                    className={`
                        px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150
                        ${
                            hasCustomRange || showCustom
                                ? "bg-info/15 text-info border border-info/30"
                                : "bg-muted text-muted-foreground border border-border hover:border-border hover:text-foreground"
                        }
                        cursor-pointer
                    `}
                >
                    Custom
                </button>
            </div>

            {/* Custom date inputs */}
            {showCustom && (
                <div className="flex items-end gap-2.5 pl-5 flex-wrap animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="flex flex-col gap-1">
                        <label
                            htmlFor="gsc-start-date"
                            className="text-xs font-medium text-muted-foreground uppercase tracking-[0.06em]"
                        >
                            Start
                        </label>
                        <input
                            id="gsc-start-date"
                            type="date"
                            value={customStart}
                            onChange={(e) => setCustomStart(e.target.value)}
                            min={minDateStr}
                            max={customEnd || maxDateStr}
                            className="
                                px-2.5 py-1.5 rounded-md text-sm text-foreground font-mono
                                bg-background border border-border
                                focus:border-info focus:outline-none focus:ring-1 focus:ring-info/30
                                transition-colors
                            "
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label
                            htmlFor="gsc-end-date"
                            className="text-xs font-medium text-muted-foreground uppercase tracking-[0.06em]"
                        >
                            End
                        </label>
                        <input
                            id="gsc-end-date"
                            type="date"
                            value={customEnd}
                            onChange={(e) => setCustomEnd(e.target.value)}
                            min={customStart || minDateStr}
                            max={maxDateStr}
                            className="
                                px-2.5 py-1.5 rounded-md text-sm text-foreground font-mono
                                bg-background border border-border
                                focus:border-info focus:outline-none focus:ring-1 focus:ring-info/30
                                transition-colors
                            "
                        />
                    </div>
                    <button
                        onClick={handleCustomApply}
                        disabled={
                            !customStart ||
                            !customEnd ||
                            customStart >= customEnd ||
                            isPending
                        }
                        className="
                            px-3 py-1.5 rounded-md text-xs font-semibold
                            bg-brand text-black border border-brand
                            hover:bg-brand/90 disabled:opacity-40 disabled:cursor-not-allowed
                            transition-colors cursor-pointer
                        "
                    >
                        {isPending ? "Loading…" : "Apply"}
                    </button>
                </div>
            )}
        </div>
    );
}
