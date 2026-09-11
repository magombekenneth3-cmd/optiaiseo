"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { generateBlog } from "@/app/actions/blog";
import { showActionError } from "@/lib/ui/action-errors";
import { Loader2, Sparkles, ChevronDown, FileText, BarChart3, Check } from "lucide-react";
import { AuthorInput, GenerateBlogModal } from "./BlogStepper";
import { UpgradeModal } from "@/components/UpgradeModal";
import { CreditGate } from "@/components/ui/CreditGate";

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
}

export function GenerateBlogButton({
    siteId,
    siteDomain,
    initialKeyword,
}: GenerateBlogButtonProps) {
    const router = useRouter();
    const [isPending, setIsPending] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [showUpgrade, setShowUpgrade] = useState(false);
    const [selectedPipeline, setSelectedPipeline] = useState<PipelineType>("STANDARD");
    const [pendingPipelineType, setPendingPipelineType] = useState<string | undefined>(undefined);

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
            if (e.key === "Escape") closeDropdown();
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

    const handleSelectPipeline = useCallback(
        (option: (typeof PIPELINE_OPTIONS)[number]) => {
            setSelectedPipeline(option.key);
            setPendingPipelineType(option.value);
            setIsDropdownOpen(false);
        },
        []
    );

    const handleGenerate = useCallback(
        async (author: AuthorInput) => {
            setModalOpen(false);
            setIsPending(true);

            const loadingId = toast.loading(
                <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">Starting…</span>
                    <span className="text-xs opacity-70">
                        Researching keywords &amp; selecting pipeline
                    </span>
                </div>
            );

            try {
                const res = await generateBlog(pendingPipelineType, siteId, author);
                toast.dismiss(loadingId);

                if (res.success) {
                    router.refresh();
                    toast.success(
                        <div className="flex flex-col gap-0.5">
                            <span className="font-semibold">Your post is being written</span>
                            <span className="text-xs opacity-70">
                                Research and generation are running in the background.
                            </span>
                        </div>,
                        { duration: 8000 }
                    );
                } else {
                    const code = (res as { success: false; error?: string; code?: string }).code;
                    if (code === "insufficient_credits" || code === "rate_limit") {
                        setShowUpgrade(true);
                    } else {
                        showActionError(res as { success: false; error?: string; code?: string });
                    }
                }
            } catch (error: unknown) {
                toast.dismiss(loadingId);
                toast.error(
                    <div className="flex flex-col gap-0.5">
                        <span className="font-semibold">Network error</span>
                        <span className="text-xs opacity-80">
                            {(error as Error)?.message ||
                                "Please check your connection and try again."}
                        </span>
                    </div>
                );
            } finally {
                setIsPending(false);
            }
        },
        [pendingPipelineType, siteId, router]
    );

    const currentOption =
        PIPELINE_OPTIONS.find((o) => o.key === selectedPipeline) ?? PIPELINE_OPTIONS[0];

    return (
        <>
            <div className="relative inline-flex flex-col items-center gap-2">
                <CreditGate action="blog_generation">
                    <div className="flex items-stretch">
                        <button
                            type="button"
                            onClick={() => openModal(currentOption.value)}
                            disabled={isPending}
                            className="inline-flex items-center justify-center gap-2 rounded-l-xl border border-r-0 border-emerald-500/30 bg-emerald-500/15 px-5 py-2.5 text-sm font-bold text-emerald-300 transition-all duration-150 hover:bg-emerald-500/20 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Starting…
                                </>
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4" />
                                    Generate Post
                                </>
                            )}
                        </button>
                        <button
                            ref={triggerRef}
                            type="button"
                            onClick={() => setIsDropdownOpen((v) => !v)}
                            disabled={isPending}
                            aria-expanded={isDropdownOpen}
                            aria-haspopup="true"
                            aria-label="Select generation type"
                            className="inline-flex items-center justify-center rounded-r-xl border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-2.5 text-emerald-300 transition-all duration-150 hover:bg-emerald-500/20 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <ChevronDown
                                className={`h-4 w-4 transition-transform duration-150 ${
                                    isDropdownOpen ? "rotate-180" : ""
                                }`}
                            />
                        </button>
                    </div>
                </CreditGate>

                {!isPending && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/15 bg-emerald-500/5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-400/70">
                        Research-backed generation
                    </span>
                )}

                {isDropdownOpen && (
                    <div
                        ref={dropdownRef}
                        role="menu"
                        aria-label="Generation type"
                        className="absolute right-0 top-full z-50 mt-2 w-72 origin-top-right animate-in fade-in zoom-in-95 rounded-xl border border-border bg-card p-1.5 shadow-lg duration-150 sm:w-80"
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