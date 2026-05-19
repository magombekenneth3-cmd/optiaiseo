"use client";

import React, { useState, useEffect } from "react";
import { ContentEditor } from "@/app/dashboard/blogs/ContentEditor";
import { RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface EditorShellProps {
    initialKeyword?: string;
}

export function EditorShell({ initialKeyword = "" }: EditorShellProps) {
    const [draftContent, setDraftContent] = useState("");
    const [draftKeyword, setDraftKeyword] = useState(initialKeyword);
    const [hasRestored, setHasRestored] = useState(false);

    // Load from localStorage on mount
    useEffect(() => {
        const savedContent = localStorage.getItem("optiaiseo:editor-draft-content");
        const savedKeyword = localStorage.getItem("optiaiseo:editor-draft-keyword");

        if (savedContent && savedContent.trim()) {
            setDraftContent(savedContent);
            if (savedKeyword) setDraftKeyword(savedKeyword);
            toast.info("Restored your unsaved draft from local storage.", {
                duration: 4000,
                action: {
                    label: "Clear",
                    onClick: () => handleClear(),
                },
            });
        } else if (initialKeyword) {
            setDraftKeyword(initialKeyword);
        }
        setHasRestored(true);
    }, [initialKeyword]);

    // Save to localStorage when content or keyword changes
    useEffect(() => {
        if (!hasRestored) return;
        
        const saveTimeout = setTimeout(() => {
            localStorage.setItem("optiaiseo:editor-draft-content", draftContent);
            localStorage.setItem("optiaiseo:editor-draft-keyword", draftKeyword);
        }, 1000);

        return () => clearTimeout(saveTimeout);
    }, [draftContent, draftKeyword, hasRestored]);

    const handleClear = () => {
        setDraftContent("");
        setDraftKeyword("");
        localStorage.removeItem("optiaiseo:editor-draft-content");
        localStorage.removeItem("optiaiseo:editor-draft-keyword");
        toast.success("Draft cleared.");
    };

    const handleSaveLocal = () => {
        localStorage.setItem("optiaiseo:editor-draft-content", draftContent);
        localStorage.setItem("optiaiseo:editor-draft-keyword", draftKeyword);
        toast.success("Draft saved manually to browser cache.");
    };

    if (!hasRestored) {
        return (
            <div className="flex items-center justify-center h-[500px] border border-border rounded-xl bg-card">
                <span className="text-sm text-muted-foreground">Loading workspace...</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="flex justify-between items-center gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground font-mono">
                    Draft automatically saved to local storage
                </span>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSaveLocal}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50 text-xs font-semibold transition-colors"
                        title="Force Save to Browser Cache"
                    >
                        <Save className="w-3.5 h-3.5" />
                        Save Draft
                    </button>
                    <button
                        onClick={handleClear}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.04] text-red-400 hover:bg-red-500/[0.08] text-xs font-semibold transition-colors"
                        title="Clear Editor Content"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear All
                    </button>
                </div>
            </div>
            
            <div className="flex-1 min-h-[620px]">
                <ContentEditor
                    initialContent={draftContent}
                    initialKeyword={draftKeyword}
                    onContentChange={(val) => setDraftContent(val)}
                />
            </div>
        </div>
    );
}
