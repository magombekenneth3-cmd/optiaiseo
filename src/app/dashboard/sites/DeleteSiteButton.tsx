"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { deleteSite } from "@/app/actions/site";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

export function DeleteSiteButton({ siteId, domain }: { siteId: string; domain: string }) {
    const router = useRouter();
    const [showModal, setShowModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (showModal) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => { document.body.style.overflow = ""; };
    }, [showModal]);

    const handleDelete = useCallback(async () => {
        setIsDeleting(true);
        try {
            const result = await deleteSite(siteId);
            if (result.success) {
                toast.success(`${domain} has been deleted.`);
                setShowModal(false);
                router.refresh();
            } else {
                toast.error(result.error || "Failed to delete site.");
            }
        } catch {
            toast.error("An unexpected error occurred. Please try again.");
        } finally {
            setIsDeleting(false);
        }
    }, [siteId, domain, router]);

    return (
        <>
            <button
                type="button"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowModal(true);
                }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                title={`Delete ${domain}`}
                aria-label={`Delete site ${domain}`}
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>

            {showModal && typeof document !== "undefined" && createPortal(
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
                    style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
                    onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
                >
                    <div
                        className="rounded-2xl border border-zinc-700 w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
                        style={{ backgroundColor: "#0f0f0f" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: "rgba(239,68,68,0.1)" }}>
                            <svg className="w-6 h-6 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold mb-2 text-white">Delete {domain}?</h2>
                        <p className="text-zinc-400 text-sm mb-6">
                            Are you absolutely sure? This will permanently remove all associated Audit Reports, Keyword Tracking, and Blog Posts. This action cannot be undone.
                        </p>
                        <div className="flex items-center gap-3 w-full">
                            <button
                                type="button"
                                onClick={() => setShowModal(false)}
                                disabled={isDeleting}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-700 hover:bg-zinc-800 transition-colors font-medium text-sm text-zinc-300 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={isDeleting}
                                className="flex-1 flex justify-center items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors disabled:opacity-50"
                            >
                                {isDeleting ? (
                                    <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Deleting…</>
                                ) : "Yes, Delete Site"}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
