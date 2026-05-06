"use client";

import { useEffect } from "react";
import { formatError } from "@/lib/logger";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log to structured error tracking — replace with Sentry/Datadog when available
        console.error("[GlobalError]", formatError(error), error.digest ? `digest=${error.digest}` : "");
    }, [error]);

    return (
        <html>
            <body
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "100vh",
                    gap: "1.5rem",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    background: "#0a0a0a",
                    color: "#fafafa",
                    margin: 0,
                    padding: "2rem",
                    textAlign: "center",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "0.75rem",
                        maxWidth: "480px",
                    }}
                >
                    <span style={{ fontSize: "2.5rem" }}>⚠️</span>
                    <h2
                        style={{
                            margin: 0,
                            fontSize: "1.5rem",
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                        }}
                    >
                        Something went wrong
                    </h2>
                    <p style={{ margin: 0, color: "#a1a1aa", fontSize: "0.95rem", lineHeight: 1.6 }}>
                        An unexpected error occurred. Our team has been notified.
                        {error.digest && (
                            <span style={{ display: "block", marginTop: "0.5rem", fontSize: "0.75rem", color: "#52525b" }}>
                                Reference: {error.digest}
                            </span>
                        )}
                    </p>
                    <button
                        onClick={reset}
                        style={{
                            marginTop: "0.5rem",
                            padding: "0.625rem 1.5rem",
                            borderRadius: "0.75rem",
                            border: "1px solid #27272a",
                            background: "#18181b",
                            color: "#fafafa",
                            fontSize: "0.875rem",
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "opacity 0.15s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
