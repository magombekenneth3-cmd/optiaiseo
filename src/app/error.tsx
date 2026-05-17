"use client";

import { useEffect } from "react";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error("[GlobalError]", error.message, error.digest ? `digest=${error.digest}` : "");
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
                    <div style={{
                        width: 56, height: 56, borderRadius: 16,
                        background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.2)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fb7185" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                    </div>
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
                            <span style={{ display: "block", marginTop: "0.5rem", fontSize: "0.75rem", color: "#52525b", fontFamily: "monospace" }}>
                                Error ID: {error.digest}
                            </span>
                        )}
                    </p>
                    <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                        <button
                            onClick={reset}
                            style={{
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
                        <a
                            href="/dashboard"
                            style={{
                                padding: "0.625rem 1.5rem",
                                borderRadius: "0.75rem",
                                border: "none",
                                background: "transparent",
                                color: "#a1a1aa",
                                fontSize: "0.875rem",
                                fontWeight: 500,
                                cursor: "pointer",
                                textDecoration: "none",
                                display: "inline-flex",
                                alignItems: "center",
                            }}
                        >
                            ← Back to Dashboard
                        </a>
                    </div>
                </div>
            </body>
        </html>
    );
}
