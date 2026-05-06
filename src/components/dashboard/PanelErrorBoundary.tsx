"use client";
import React from "react";

interface Props {
    children: React.ReactNode;
    fallback?: React.ReactNode;
    label?: string;
}

interface State {
    hasError: boolean;
    errorMessage: string;
}

/**
 * Reusable class-based ErrorBoundary for dashboard panels.
 * Catches render-time errors within a subtree so one broken panel
 * does not crash the entire dashboard.
 *
 * Usage:
 *   <PanelErrorBoundary label="AEO Tracker">
 *     <AeoTrackerClient ... />
 *   </PanelErrorBoundary>
 */
export class PanelErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, errorMessage: "" };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, errorMessage: error?.message ?? "Unknown error" };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(`[PanelErrorBoundary] ${this.props.label ?? "panel"} threw:`, error, info.componentStack);
    }

    handleReset = () => {
        this.setState({ hasError: false, errorMessage: "" });
    };

    render() {
        if (!this.state.hasError) return this.props.children;

        if (this.props.fallback) return this.props.fallback;

        return (
            <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 rounded-2xl border border-dashed border-red-500/20 bg-red-500/5 text-center">
                <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <div>
                    <p className="font-semibold text-foreground">
                        {this.props.label ? `${this.props.label} failed to load` : "This panel encountered an error"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                        {this.state.errorMessage}
                    </p>
                </div>
                <button
                    onClick={this.handleReset}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                >
                    Try again
                </button>
            </div>
        );
    }
}
