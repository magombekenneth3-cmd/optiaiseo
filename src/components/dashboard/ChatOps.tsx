"use client";

import Link from "next/link";
import { Terminal } from "lucide-react";

export function ChatOpsTerminal() {
    return (
        <Link
            href="/dashboard/voice"
            // On mobile: bottom-20 clears the 64px bottom nav + safe area; z-50 floats above the nav (z-40)
            // On desktop bottom-6 / z-40 keeps the original positioning
            className="fixed bottom-20 md:bottom-6 right-4 md:right-6 p-3 md:p-4 rounded-full bg-primary/10 hover:bg-primary/20 border border-primary/30 backdrop-blur-xl shadow-2xl transition-all group z-50 md:z-40 flex items-center gap-2 md:gap-3"
            aria-label="Open AI Assistant"
        >
            <div className="relative">
                <Terminal className="w-5 h-5 md:w-6 md:h-6 text-primary group-hover:scale-110 transition-transform relative z-10" />
                <div className="absolute inset-0 bg-primary/20 blur-md rounded-full -z-10 animate-breathe" />
            </div>
            <span className="hidden md:inline font-mono text-xs font-bold text-primary tracking-widest uppercase">
                AI Assistant
            </span>
        </Link>
    );
}
