"use client";

import Link from "next/link";
import { Terminal } from "lucide-react";

export function ChatOpsTerminal() {
    return (
        <Link
            href="/dashboard/voice"
            className="fixed bottom-20 md:bottom-6 right-4 md:right-6 p-3 rounded-full bg-card border border-border hover:border-brand/30 shadow-xl transition-all group z-50 md:z-40 flex items-center gap-2"
            aria-label="Open AI Assistant"
        >
            <div className="relative">
                <Terminal className="w-5 h-5 text-foreground group-hover:text-brand transition-colors relative z-10" />
                <div className="absolute inset-0 bg-brand/15 blur-md rounded-full -z-10 animate-breathe" />
            </div>
            <span className="hidden md:inline text-xs font-semibold text-muted-foreground group-hover:text-foreground tracking-wide transition-colors">
                Ask OptiAI
            </span>
        </Link>
    );
}
