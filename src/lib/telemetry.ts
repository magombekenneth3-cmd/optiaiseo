/**
 * 7.1: OpenTelemetry distributed tracing
 * Initialised at app startup via instrumentation.ts (Next.js 15 supported).
 * Exports spans to OTEL_EXPORTER_OTLP_ENDPOINT (e.g. Grafana Tempo, Jaeger, GCP Cloud Trace).
 */
import { logger } from "@/lib/logger";

let tracer: import("@opentelemetry/api").Tracer | null = null;

export function getTracer(): import("@opentelemetry/api").Tracer | null {
    return tracer;
}

/**
 * Wraps an async function with an OpenTelemetry span.
 * Attaches `attributes` to the span and records exceptions automatically.
 * Falls back to a plain function call if OTEL is not configured (e.g. dev without OTLP endpoint).
 */
export async function traced<T>(
    spanName: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => Promise<T>,
): Promise<T> {
    if (!tracer) {
        // No tracer configured — run bare
        return fn();
    }

    return tracer.startActiveSpan(spanName, { attributes }, async (span) => {
        try {
            const result = await fn();
            span.setStatus({ code: 1 /* OK */ });
            return result;
        } catch (e: unknown) {
            span.recordException(e as Error);
            span.setStatus({ code: 2 /* ERROR */, message: (e as Error).message });
            throw e;
        } finally {
            span.end();
        }
    });
}

/**
 * Initialise OpenTelemetry SDK.
 * Import this in src/instrumentation.ts (Next.js 15 register() hook).
 */
export async function initTelemetry(): Promise<void> {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) {
        logger.info("[OTEL] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled");
        return;
    }

    try {
        const { NodeSDK }          = await import("@opentelemetry/sdk-node");
        const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
        const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
        const otelApi = await import("@opentelemetry/api");

        const sdk = new NodeSDK({
            traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
            instrumentations: [getNodeAutoInstrumentations({
                "@opentelemetry/instrumentation-http": { enabled: true },
                "@opentelemetry/instrumentation-undici": { enabled: true },
                // Disable winston instrumentation — it requires @opentelemetry/winston-transport
                // which is not installed, causing a webpack "Module not found" warning.
                "@opentelemetry/instrumentation-winston": { enabled: false },
            })],
        });

        sdk.start();
        tracer = otelApi.trace.getTracer("aiseo", "1.0.0");

        process.on("SIGTERM", () => sdk.shutdown().catch(logger.error));
        logger.info("[OTEL] Distributed tracing enabled", { endpoint });
    } catch (e) {
        logger.warn("[OTEL] Could not init telemetry (packages may not be installed)", { error: (e as Error).message });
    }
}
