"use client";

import Link from "next/link";
import { Terminal } from "lucide-react";

export function ChatOpsTerminal() {
    return (
        <Link
            href="/dashboard/voice"
            title="Ask OptiAI assistant"
            className="fixed bottom-20 md:bottom-5 right-4 md:right-5 w-10 h-10 rounded-full bg-card/90 backdrop-blur-md border border-border hover:border-brand/40 shadow-lg transition-all group z-40 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="Ask OptiAI assistant"
        >
            <Terminal className="w-4 h-4 text-muted-foreground group-hover:text-brand transition-colors" aria-hidden="true" />
        </Link>
    );
}
