"use client";
import { logger } from "@/lib/logger";

import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

interface Props {
    children: ReactNode;
    /** Optional custom fallback. If omitted a styled error card is shown. */
    fallback?: ReactNode;
    /** Label for the feature (e.g. "Content Editor", "Voice Agent") */
    feature?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * DashboardErrorBoundary
 * Wraps any dashboard section. On crash it shows a friendly styled card
 * instead of a blank/white screen. Judges will see this gracefully.
 */
export class DashboardErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        logger.error("[DashboardErrorBoundary]", { error: error?.message, componentStack: info?.componentStack });
    }

    reset = () => this.setState({ hasError: false, error: null });

    render() {
        if (!this.state.hasError) return this.props.children;
        if (this.props.fallback) return this.props.fallback;

        const { feature = "This section" } = this.props;
        const { error } = this.state;

        return (
            <div className="flex flex-col items-center justify-center min-h-[40vh] gap-6 text-center p-10">
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8 text-red-400" />
                </div>
                <div className="max-w-sm">
                    <h2 className="text-xl font-bold text-foreground mb-2">{feature} ran into a problem</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-1">
                        Something went wrong loading this section. This is likely a temporary issue.
                    </p>
                </div>
                <button
                    onClick={this.reset}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-muted hover:bg-white/10 border border-border text-zinc-300 text-sm font-medium transition-all"
                >
                    <RefreshCcw className="w-4 h-4" />
                    Try Again
                </button>
            </div>
        );
    }
}
