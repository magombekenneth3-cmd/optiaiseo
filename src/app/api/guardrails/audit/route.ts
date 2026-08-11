import { NextRequest, NextResponse } from "next/server";
import { runSeoGuardrailCheck } from "@/lib/guardrails/ci-check";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const url = body.url || "https://optiaiseo.online";

        const result = await runSeoGuardrailCheck({
            url,
            maxLcpMs: body.maxLcpMs,
            maxCls: body.maxCls,
        });

        logger.info("[Guardrails/API] Check completed", {
            url,
            passed: result.passed,
            errorCount: result.errors.length,
        });

        return NextResponse.json(result);
    } catch (error: unknown) {
        logger.error("[Guardrails/API] Audit failed:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json(
            { error: "Failed to execute guardrail check." },
            { status: 500 }
        );
    }
}
