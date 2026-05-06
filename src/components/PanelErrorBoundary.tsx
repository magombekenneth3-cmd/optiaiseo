"use client";

import { Component, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
    children: ReactNode;
    fallbackTitle?: string;
}

interface State {
    hasError: boolean;
    errorMessage: string;
}

/**
 * Generic error boundary for dashboard panels.
 * Shows a clean recovery UI instead of crashing the whole page.
 */
export class PanelErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, errorMessage: "" };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, errorMessage: error.message };
    }

    handleRetry = () => {
        this.setState({ hasError: false, errorMessage: "" });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="card-surface p-8 flex flex-col items-center text-center gap-4 border border-red-500/20 bg-red-500/5">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                    <div>
                        <p className="font-semibold text-red-300 mb-1">
                            {this.props.fallbackTitle ?? "Something went wrong"}
                        </p>
                        <p className="text-xs text-zinc-500 max-w-xs">{this.state.errorMessage}</p>
                    </div>
                    <button
                        onClick={this.handleRetry}
                        className="inline-flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Try again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
