"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen } from "lucide-react";
import { GenerateBlogModal, type AuthorInput } from "@/app/dashboard/blogs/BlogStepper";
import { generateBlog } from "@/app/actions/blog";
import { showActionError } from "@/lib/ui/action-errors";

export function GenerateBlogButton({
    keyword,
    siteId,
    siteDomain,
}: {
    keyword: string;
    position?: number;
    impressions?: number;
    siteId: string;
    siteDomain?: string;
    intent?: string;
}) {
    const router = useRouter();
    const [modalOpen, setModalOpen] = useState(false);
    const [isPending, setIsPending] = useState(false);

    const handleGenerate = async (author: AuthorInput) => {
        setModalOpen(false);
        setIsPending(true);

        const loadingId = toast.loading(
            <div className="flex flex-col gap-0.5">
                <span className="font-semibold">Crafting your SEO post…</span>
                <span className="text-xs opacity-70">Researching, writing, optimising — ~30 sec</span>
            </div>
        );

        try {
            const res = await generateBlog(undefined, siteId, { ...author, keyword });
            toast.dismiss(loadingId);

            if (res.success) {
                // Deep-link to the specific draft review modal so the user
                // lands directly on the new post — not the generic blogs list.
                const blogId = (res as { success: true; blog?: { id: string } }).blog?.id;
                toast.success(
                    <div className="flex flex-col gap-0.5">
                        <span className="font-semibold">Post drafted successfully!</span>
                        <span className="text-xs opacity-70">Opening your draft for review…</span>
                    </div>,
                    { duration: 3000 }
                );
                router.push(blogId ? `/dashboard/blogs?review=${blogId}` : "/dashboard/blogs");
            } else {
                showActionError(res as { success: false; error?: string; code?: string });
            }
        } catch (error: unknown) {
            toast.dismiss(loadingId);
            toast.error(
                <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">Network error</span>
                    <span className="text-xs opacity-80">
                        {(error as Error)?.message || "Please check your connection and try again."}
                    </span>
                </div>
            );
        } finally {
            setIsPending(false);
        }
    };

    // Derive a display domain from siteId as fallback
    const domain = siteDomain ?? "";

    return (
        <>
            <button
                onClick={() => setModalOpen(true)}
                disabled={isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg border border-emerald-500/20 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
                <BookOpen className="w-3 h-3 shrink-0" />
                Generate Blog
            </button>

            {modalOpen && (
                <GenerateBlogModal
                    siteId={siteId}
                    siteDomain={domain}
                    initialKeyword={keyword}
                    onClose={() => setModalOpen(false)}
                    onGenerate={handleGenerate}
                />
            )}
        </>
    );
}
