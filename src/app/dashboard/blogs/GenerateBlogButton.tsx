"use client";

import { useState, useEffect, useRef, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { isSurgicalRefreshSelection, submitTopicStepperAction } from "@/lib/blog/topic-submission";
import { Loader2, Sparkles, ChevronDown, FileText, BarChart3, Check } from "lucide-react";
import { AuthorInput, GenerateBlogModal } from "./BlogStepper";
import { UpgradeModal } from "@/components/UpgradeModal";
import { CreditGate } from "@/components/ui/CreditGate";
import { SerpGateBanner } from "./SerpGateBanner";
import type { SerpGateDecision } from "@/lib/blog/serp-gate";

type PipelineType = "STANDARD" | "DATA_REPORT";

const PIPELINE_OPTIONS: {
    key: PipelineType;
    label: string;
    description: string;
    icon: typeof FileText;
    accent: string;
    accentBg: string;
    accentBorder: string;
    value: string | undefined;
}[] = [
    {
        key: "STANDARD",
        label: "Standard Post",
        description: "Evergreen or trending SEO content",
        icon: FileText,
        accent: "text-emerald-400",
        accentBg: "bg-emerald-500/10",
        accentBorder: "border-emerald-500/20",
        value: undefined,
    },
    {
        key: "DATA_REPORT",
        label: "Data-Journalism Report",
        description: "Research-driven content built to attract high-authority backlinks",
        icon: BarChart3,
        accent: "text-purple-400",
        accentBg: "bg-purple-500/10",
        accentBorder: "border-purple-500/20",
        value: "DATA_REPORT",
    },
];

interface GenerateBlogButtonProps {
    siteId: string;
    siteDomain: string;
    initialKeyword?: string;
    autoOpen?: boolean;
}

export function GenerateBlogButton({
    siteId,
    siteDomain,
    initialKeyword,
    autoOpen = false,
}: GenerateBlogButtonProps) {
    const router = useRouter();
    const menuId = useId();
    const autoOpenedRef = useRef(false);
    const [isPending, setIsPending] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [showUpgrade, setShowUpgrade] = useState(false);
    const [selectedPipeline, setSelectedPipeline] = useState<PipelineType>("STANDARD");
    const [pendingPipelineType, setPendingPipelineType] = useState<string | undefined>(undefined);

    // SERP gate state
    const [serpGateDecision, setSerpGateDecision] = useState<SerpGateDecision | null>(null);
    const [preflightId, setPreflightId] = useState<string | null>(null);
    const [pendingAuthor, setPendingAuthor] = useState<AuthorInput | null>(null);
    const [pendingKeyword, setPendingKeyword] = useState<string>("");
    const generationRequestId = useRef<string | null>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const closeDropdown = useCallback(() => setIsDropdownOpen(false), []);

    useEffect(() => {
        if (!isDropdownOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(target) &&
                triggerRef.current &&
                !triggerRef.current.contains(target)
            ) {
                closeDropdown();
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                closeDropdown();
                triggerRef.current?.focus();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [isDropdownOpen, closeDropdown]);

    const openModal = useCallback(
        (type?: string) => {
            setPendingPipelineType(type);
            setIsDropdownOpen(false);
            setModalOpen(true);
        },
        []
    );

    useEffect(() => {
        if (autoOpen && !autoOpenedRef.current) {
            autoOpenedRef.current = true;
            openModal(undefined);
        }
    }, [autoOpen, openModal]);

    const handleSelectPipeline = useCallback(
        (option: (typeof PIPELINE_OPTIONS)[number]) => {
            setSelectedPipeline(option.key);
            setPendingPipelineType(option.value);
            setIsDropdownOpen(false);
        },
        []
    );

    /** Runs either surgical existing-page refresh or generateBlog after gate checks. */
    const executeGenerate = useCallback(
        async (author: AuthorInput, options?: { preflightId?: string; forceSerpMismatch?: boolean }): Promise<{ success: boolean; error?: string }> => {
            return submitTopicStepperAction({
                pipelineType: pendingPipelineType,
                siteId,
                author,
                options,
                requestIdRef: generationRequestId,
                setIsPending,
                onSuccess: () => router.refresh(),
                onUpgradeRequired: () => setShowUpgrade(true),
            });
        },
        [pendingPipelineType, siteId, router]
    );

    const handleGenerate = useCallback(
        async (author: AuthorInput): Promise<{ success: boolean; error?: string }> => {
            // Surgical page refreshes optimize an existing ranking page directly without a new-article SERP gate
            if (isSurgicalRefreshSelection(author)) {
                return await executeGenerate(author);
            }

            const keyword = author.keyword?.trim() ?? "";

            if (keyword) {
                // Run SERP preflight before consuming credits
                setPendingAuthor(author);
                setPendingKeyword(keyword);
                setIsPending(true);
                try {
                    const res = await fetch("/api/blogs/serp-gate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ keyword, siteId }),
                    });
                    const data = await res.json() as {
                        decision: SerpGateDecision;
                        preflightId: string | null;
                    };
                    const decision = data.decision;

                    if (decision.verdict === "BLOCK" || decision.verdict === "WARN") {
                        setSerpGateDecision(decision);
                        setPreflightId(data.preflightId);
                        setIsPending(false);
                        return { success: true };
                    }
                    // ALLOW or SKIP — proceed
                    return await executeGenerate(author, { preflightId: data.preflightId ?? undefined });
                } catch {
                    // Preflight network error — fail-open
                    return await executeGenerate(author);
                } finally {
                    setIsPending(false);
                }
            } else {
                // No keyword — skip preflight
                return await executeGenerate(author);
            }
        },
        [siteId, executeGenerate]
    );

    /** User confirmed the WARN — proceed with forceSerpMismatch */
    const handleGateConfirm = useCallback(async () => {
        if (!pendingAuthor) return;
        setSerpGateDecision(null);
        const result = await executeGenerate(pendingAuthor, {
            preflightId: preflightId ?? undefined,
            forceSerpMismatch: true,
        });
        if (result && !result.success) {
            // Post-gate generation failure — re-open modal with saved author form state intact
            setModalOpen(true);
        } else {
            setPendingAuthor(null);
            setPreflightId(null);
        }
    }, [pendingAuthor, preflightId, executeGenerate]);

    const handleGateCancel = useCallback(() => {
        setSerpGateDecision(null);
        setPendingAuthor(null);
        setPreflightId(null);
    }, []);

    const currentOption =
        PIPELINE_OPTIONS.find((o) => o.key === selectedPipeline) ?? PIPELINE_OPTIONS[0];

    return (
        <>
            {/* SERP gate banner — shown above generate button when WARN/BLOCK */}
            {serpGateDecision && (serpGateDecision.verdict === "WARN" || serpGateDecision.verdict === "BLOCK") && (
                <div className="mb-3 w-full max-w-sm">
                    <SerpGateBanner
                        decision={serpGateDecision}
                        keyword={pendingKeyword}
                        onConfirm={handleGateConfirm}
                        onCancel={handleGateCancel}
                    />
                </div>
            )}

            <div className="relative inline-flex flex-col items-end">
                <CreditGate action="blog_generation">
                    <div className="inline-flex items-stretch rounded-xl shadow-sm shadow-emerald-500/20">
                        <button
                            type="button"
                            onClick={() => {
                                if (isPending) return;
                                openModal(currentOption.value);
                            }}
                            aria-disabled={isPending}
                            aria-busy={isPending}
                            className="inline-flex items-center justify-center gap-2 min-h-10 rounded-l-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                    Starting…
                                </>
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                                    {currentOption.key === "DATA_REPORT" ? "Generate Report" : "Generate Post"}
                                </>
                            )}
                        </button>
                        <button
                            ref={triggerRef}
                            type="button"
                            onClick={() => {
                                if (isPending) return;
                                setIsDropdownOpen((v) => !v);
                            }}
                            aria-disabled={isPending}
                            aria-expanded={isDropdownOpen}
                            aria-haspopup="menu"
                            aria-controls={menuId}
                            aria-label="Choose article workflow"
                            className="inline-flex items-center justify-center min-h-10 rounded-r-xl border-l border-zinc-950/15 bg-emerald-500 px-2.5 py-2 text-zinc-950 transition-colors hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
                        >
                            <ChevronDown
                                className={`h-4 w-4 transition-transform duration-150 ${
                                    isDropdownOpen ? "rotate-180" : ""
                                }`}
                                aria-hidden="true"
                            />
                        </button>
                    </div>
                </CreditGate>

                {isDropdownOpen && (
                    <div
                        id={menuId}
                        ref={dropdownRef}
                        role="menu"
                        aria-label="Generation type"
                        className="absolute right-0 top-full z-50 mt-2 w-72 origin-top-right animate-in fade-in zoom-in-95 rounded-xl border border-border bg-card p-1.5 shadow-xl duration-150 sm:w-80"
                    >
                        <div className="mb-1.5 px-3 pt-2">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                Generation type
                            </p>
                        </div>

                        {PIPELINE_OPTIONS.map((option) => {
                            const Icon = option.icon;
                            const isSelected = selectedPipeline === option.key;

                            return (
                                <button
                                    key={option.key}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => handleSelectPipeline(option)}
                                    className={`group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-150 ${
                                        isSelected
                                            ? "bg-muted/60 border border-border"
                                            : "border border-transparent hover:border-border hover:bg-muted/40"
                                    }`}
                                >
                                    <div
                                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ${option.accentBg} ${option.accentBorder} border`}
                                    >
                                        <Icon
                                            className={`h-4 w-4 transition-transform duration-150 group-hover:scale-110 ${option.accent}`}
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-foreground">
                                            {option.label}
                                        </p>
                                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                            {option.description}
                                        </p>
                                    </div>
                                    {isSelected && (
                                        <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-400" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {modalOpen && (
                <GenerateBlogModal
                    siteId={siteId}
                    siteDomain={siteDomain}
                    pipelineType={pendingPipelineType}
                    initialKeyword={initialKeyword}
                    initialAuthor={pendingAuthor ?? undefined}
                    onClose={() => setModalOpen(false)}
                    onGenerate={handleGenerate}
                />
            )}

            {showUpgrade &&
                typeof window !== "undefined" &&
                createPortal(
                    <UpgradeModal
                        currentTier="FREE"
                        onClose={() => setShowUpgrade(false)}
                    />,
                    document.body
                )}
        </>
    );
}
