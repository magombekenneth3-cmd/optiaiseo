import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { rateLimit, getClientIp } from "@/lib/rate-limit/check";
import { logger } from "@/lib/logger";

// ── Validation ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Accept only CUID2-shaped IDs (25 chars, lowercase alphanumeric).
 * Rejects path-traversal payloads and SQL-injection probes before they
 * ever reach Prisma, and prevents audit-ID enumeration via timing.
 */
const AUDIT_ID_RE = /^[a-z0-9]{20,30}$/;

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const ip = getClientIp(req);
    const limited = await rateLimit("freeUnlock", ip);
    if (limited) return limited;

    let body: { auditId?: unknown; email?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { auditId, email } = body;

    if (
        !auditId ||
        typeof auditId !== "string" ||
        !AUDIT_ID_RE.test(auditId)
    ) {
        return NextResponse.json({ error: "auditId required" }, { status: 400 });
    }

    if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
        return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase();

    // ── Fetch audit ───────────────────────────────────────────────────────────

    const audit = await prisma.freeAudit.findUnique({
        where: { id: auditId },
        select: {
            domain: true,
            overallScore: true,
            allRecs: true,
            expiresAt: true,
            status: true,
        },
    });

    if (!audit) {
        return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }
    if (audit.status !== "DONE") {
        return NextResponse.json(
            { error: "Audit is not complete yet" },
            { status: 409 }
        );
    }
    if (audit.expiresAt < new Date()) {
        return NextResponse.json(
            { error: "This audit has expired. Run a new one." },
            { status: 410 }
        );
    }

    // ── Persist lead (idempotent) ─────────────────────────────────────────────
    // Single createMany + skipDuplicates is the correct idempotent pattern.
    // The previous double-upsert/createMany combo caused a redundant round-trip
    // and could emit confusing Prisma constraint warnings in logs.

    await prisma.freeAuditLead
        .createMany({
            data: [
                {
                    email: normalizedEmail,
                    auditId,
                    domain: audit.domain,
                },
            ],
            skipDuplicates: true,
        })
        .catch((err: unknown) => {
            // Non-fatal — lead capture failure must not block report delivery.
            logger.warn("[FreeUnlock] Lead upsert failed (non-fatal)", {
                error: (err as Error)?.message ?? String(err),
                auditId,
            });
        });

    // ── Fire background email job (Inngest) ───────────────────────────────────
    // Sending is intentionally async: the HTTP response returns immediately so
    // the client can render the report. Inngest handles retries, concurrency
    // capping, and delivery observability — replacing the previous silent catch.

    const recs = Array.isArray(audit.allRecs) ? audit.allRecs : [];
    const score = typeof audit.overallScore === "number" ? audit.overallScore : 0;

    await inngest
        .send({
            name: "email/free-report.send",
            data: {
                email: normalizedEmail,
                domain: audit.domain,
                score,
                recs,
                auditId,
            },
        })
        .catch((err: unknown) => {
            // Inngest.send() should never throw in practice, but guard anyway.
            logger.error("[FreeUnlock] Failed to enqueue report email", {
                error: (err as Error)?.message ?? String(err),
                auditId,
            });
        });

    return NextResponse.json({ success: true, allRecs: recs });
}