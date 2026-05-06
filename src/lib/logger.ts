type LogLevel = "debug" | "info" | "warn" | "error";

const isProd = process.env.NODE_ENV === "production";

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (level === "debug" && isProd) return;
    const entry = { level, message, timestamp: new Date().toISOString(), ...meta };
    if (level === "error") {
        console.error(JSON.stringify(entry));
    } else if (level === "warn") {
        console.warn(JSON.stringify(entry));
    } else {
        console.log(JSON.stringify(entry));
    }
}

export const logger = {
    debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
    info:  (message: string, meta?: Record<string, unknown>) => log("info",  message, meta),
    warn:  (message: string, meta?: Record<string, unknown>) => log("warn",  message, meta),
    error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};

/**
 * Standardised error formatter for use across all log call sites.
 * Always preserves the stack trace; handles non-Error throws gracefully.
 *
 * Usage:
 * ```ts
 * logger.error("[Context] Something failed", { error: formatError(err) });
 * ```
 */
export function formatError(err: unknown): string {
    if (err instanceof Error) return err.stack ?? err.message;
    return String(err);
}
