"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { generateBlog } from "@/app/actions/blog";
import { showActionError } from "@/lib/ui/action-errors";
import { Loader2, Sparkles, ChevronDown, FileText, BarChart } from "lucide-react";
import { AuthorInput, GenerateBlogModal } from "./BlogStepper";
import { UpgradeModal } from "@/components/UpgradeModal";

interface GenerateBlogButtonProps {
    siteId: string;
    siteDomain: string;
    initialKeyword?: string;
}

export function GenerateBlogButton({ siteId, siteDomain, initialKeyword }: GenerateBlogButtonProps) {
    const router = useRouter();
    const [isPending, setIsPending] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [showUpgrade, setShowUpgrade] = useState(false);
    const [pendingPipelineType, setPendingPipelineType] = useState<string | undefined>(undefined);
    const openModal = (type?: string) => {
        setPendingPipelineType(type);
        setIsDropdownOpen(false);
        setModalOpen(true);
    };

    const handleGenerate = async (author: AuthorInput) => {
        setModalOpen(false);
        setIsPending(true);

        const loadingId = toast.loading(
            <div className="flex flex-col gap-0.5">
                <span className="font-semibold">Queuing your post…</span>
                <span className="text-xs opacity-70">Researching keywords &amp; picking pipeline — just a moment</span>
            </div>
        );

        try {
            const res = await generateBlog(pendingPipelineType, siteId, author);
            toast.dismiss(loadingId);

            if (res.success) {
                router.refresh();
                toast.success(
                    <div className="flex flex-col gap-0.5">
                        <span className="font-semibold">✍️ Writing your post…</span>
                        <span className="text-xs opacity-70">
                            Generation is running in the background — it will appear below when ready (~1 min).
                        </span>
                    </div>,
                    { duration: 8000 }
                );
            } else {
                // Intercept limit errors and show the upgrade modal instead of a toast
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
                    <span className="text-xs opacity-80">{(error as Error)?.message || "Please check your connection and try again."}</span>
                </div>
            );
        } finally {
            setIsPending(false);
        }
    };

    return (
        <>
            <div className="relative inline-block text-left">
                <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center">
                        <button
                            onClick={() => openModal()}
                            disabled={isPending}
                            className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black px-5 py-2.5 rounded-l-xl font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_25px_rgba(16,185,129,0.35)] min-w-[155px]"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Generating…
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4" />
                                    Generate Post
                                </>
                            )}
                        </button>
                        <button
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            disabled={isPending}
                            className="inline-flex items-center justify-center px-3 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-r-xl border-l border-emerald-600/30 transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_25px_rgba(16,185,129,0.35)]"
                        >
                            <ChevronDown className="w-4 h-4" />
                        </button>
                    </div>
                    {!isPending && (
                        <span className="text-xs font-bold text-emerald-400/80 uppercase tracking-widest flex items-center gap-1.5 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60 animate-pulse" />
                            Uses AnswerThePublic
                        </span>
                    )}
                </div>

                {isDropdownOpen && typeof window !== "undefined" && createPortal(
                    <div style={{ position: "fixed", inset: 0, zIndex: 9999 }} aria-modal="true" role="dialog">
                        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)" }} onClick={() => setIsDropdownOpen(false)} />
                        <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", pointerEvents: "none" }}>
                            <div className="pointer-events-auto w-64 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] bg-card border border-border animate-in fade-in zoom-in-95 duration-150" role="menu">
                                <button
                                    onClick={() => openModal()}
                                    className="text-left w-full px-4 py-3 text-sm text-zinc-300 hover:bg-muted hover:text-white flex items-start gap-3 transition-colors rounded-t-xl"
                                    role="menuitem"
                                >
                                    <FileText className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" />
                                    <div className="flex flex-col">
                                        <span className="font-semibold text-white">Standard Post</span>
                                        <span className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                            Evergreen or trending guide targeting your next top keyword.
                                        </span>
                                    </div>
                                </button>
                                <button
                                    onClick={() => openModal("DATA_REPORT")}
                                    className="text-left w-full px-4 py-3 text-sm text-zinc-300 hover:bg-muted hover:text-white flex items-start gap-3 transition-colors border-t border-border rounded-b-xl"
                                    role="menuitem"
                                >
                                    <BarChart className="w-4 h-4 mt-0.5 text-purple-400 shrink-0" />
                                    <div className="flex flex-col">
                                        <span className="font-semibold text-white">Data-Journalism Report</span>
                                        <span className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                            Synthesize research stats to earn high-authority backlinks.
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
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

            {/* Upgrade modal — shown when monthly blog limit is hit */}
            {showUpgrade && typeof window !== "undefined" && createPortal(
                <UpgradeModal
                    currentTier="FREE"
                    onClose={() => setShowUpgrade(false)}
                />,
                document.body
            )}
        </>
    );
}