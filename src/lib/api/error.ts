import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export function apiError(
  message: string,
  status: number,
  context?: { tag?: string; error?: unknown }
): NextResponse {
  if (context?.tag || context?.error) {
    const meta: Record<string, unknown> = {};
    if (context.error) {
      meta.error =
        context.error instanceof Error
          ? context.error.message
          : String(context.error);
    }
    logger.error(`[${context.tag ?? "API"}] ${message}`, meta);
  }
  return NextResponse.json({ error: message }, { status });
}
