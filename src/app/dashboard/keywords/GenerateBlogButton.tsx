"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    BarChart3,
    Check,
    ChevronDown,
    FileText,
    Loader2,
    Sparkles,
} from "lucide-react";
import { generateBlog } from "@/app/actions/blog";
import { showActionError } from "@/lib/ui/action-errors";
import { AuthorInput, GenerateBlogModal } from "@/app/dashboard/blogs/BlogStepper";
import { UpgradeModal } from "@/components/UpgradeModal";
import { CreditGate } from "@/components/ui/CreditGate";

interface GenerateBlogButtonProps {
    siteId: string;
    siteDomain: string;
    initialKeyword?: string;
}

type PipelineType = "STANDARD" | "DATA_REPORT";

const pipelineOptions: Array<{
    value: PipelineType;
    label: string;
    description: string;
    icon: typeof FileText;
    iconClassName: string;
}> = [
        {
            value: "STANDARD",
            label: "Standard Post",
            description: "Evergreen or trending SEO content for your next keyword.",
            icon: FileText,
            iconClassName: "text-emerald-400 bg-emerald-500/10",
        },
        {
            value: "DATA_REPORT",
            label: "Data-Journalism Report",
            description:
                "Research-driven content designed to attract high-authority backlinks.",
            icon: BarChart3,
            iconClassName: "text-violet-400 bg-violet-500/10",
        },
    ];

export function GenerateBlogButton({
    siteId,
    siteDomain,
    initialKeyword,
}: GenerateBlogButtonProps) {
    const router = useRouter();
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const [isPending, setIsPending] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [showUpgrade, setShowUpgrade] = useState(false);
    const [pendingPipelineType, setPendingPipelineType] =
        useState<string | undefined>(undefined);

    const openModal = (type?: PipelineType) => {
        setPendingPipelineType(type === "STANDARD" ? undefined : type);
        setIsDropdownOpen(false);
        setModalOpen(true);
    };

    useEffect(() => {
        if (!isDropdownOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node;

            if (!menuRef.current?.contains(target)) {
                setIsDropdownOpen(false);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsDropdownOpen(false);
                triggerRef.current?.focus();
            }
        };

        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isDropdownOpen]);

    const handleGenerate = async (author: AuthorInput) => {
        setModalOpen(false);
        setIsPending(true);

        const loadingId = toast.loading(
            <div className="flex flex-col gap-0.5">
                <span className="font-semibold">Starting your post…</span>
                <span className="text-xs opacity-70">
                    Preparing research and generation.
                </span>
            </div>
        );

        try {
            const res = await generateBlog(
                pendingPipelineType,
                siteId,
                author
            );

            toast.dismiss(loadingId);

            if (res.success) {
                router.refresh();

                toast.success(
                    <div className="flex flex-col gap-0.5">
                        <span className="font-semibold">
                            Your post is being written
                        </span>
                        <span className="text-xs opacity-70">
                            Research and generation are running in the
                            background.
                        </span>
                    </div>,
                    { duration: 8000 }
                );

                return;
            }

            const code = (
                res as {
                    success: false;
                    error?: string;
                    code?: string;
                }
            ).code;

            if (
                code === "insufficient_credits" ||
                code === "rate_limit"
            ) {
                setShowUpgrade(true);
            } else {
                showActionError(
                    res as {
                        success: false;
                        error?: string;
                        code?: string;
                    }
                );
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
    };

    return (
        <>
            <div
                ref={menuRef}
                className="relative inline-flex flex-col items-center gap-2"
            >
                <CreditGate action="blog_generation">
                    <div className="inline-flex items-stretch">
                        <button
                            type="button"
                            onClick={() => openModal("STANDARD")}
                            disabled={isPending}
                            className="inline-flex min-h-11 min-w-[156px] items-center justify-center gap-2 rounded-l-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-black shadow-[0_0_18px_rgba(16,185,129,0.16)] transition-all duration-200 hover:bg-emerald-400 hover:shadow-[0_0_26px_rgba(16,185,129,0.28)] focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
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
                            onClick={() =>
                                setIsDropdownOpen((current) => !current)
                            }
                            disabled={isPending}
                            aria-label="Choose generation type"
                            aria-haspopup="menu"
                            aria-expanded={isDropdownOpen}
                            className={`inline-flex min-h-11 items-center justify-center rounded-r-xl border-l border-emerald-700/25 bg-emerald-500 px-3 text-black transition-all duration-200 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 ${isDropdownOpen ? "bg-emerald-400" : ""
                                }`}
                        >
                            <ChevronDown
                                className={`h-4 w-4 transition-transform duration-200 ${isDropdownOpen ? "rotate-180" : ""
                                    }`}
                            />
                        </button>
                    </div>
                </CreditGate>

                {!isPending && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/15 bg-emerald-500/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400/75">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                        Research-backed generation
                    </span>
                )}

                {isDropdownOpen && (
                    <div
                        className="absolute right-0 top-[calc(100%+3.5rem)] z-50 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-2xl shadow-black/25"
                        role="menu"
                        aria-label="Generation type"
                    >
                        <div className="px-3 pb-2 pt-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                Generation type
                            </p>
                        </div>

                        {pipelineOptions.map((option, index) => {
                            const Icon = option.icon;

                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => openModal(option.value)}
                                    className={`group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted focus:bg-muted focus:outline-none ${index > 0
                                            ? "border-t border-border/70"
                                            : ""
                                        }`}
                                >
                                    <span
                                        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${option.iconClassName}`}
                                    >
                                        <Icon className="h-4 w-4" />
                                    </span>

                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                            {option.label}

                                            {index === 0 && (
                                                <Check className="h-3.5 w-3.5 text-emerald-400 opacity-0 transition-opacity group-hover:opacity-100" />
                                            )}
                                        </span>

                                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                            {option.description}
                                        </span>
                                    </span>
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