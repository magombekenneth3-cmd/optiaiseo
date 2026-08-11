import { logger } from "@/lib/logger";

export type OutboxType = "INDEXNOW" | "GOOGLE_INDEXING" | "AGENCY_EMAIL" | "AI_REFRESH";
export type OutboxStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface OutboxRecord {
    id: string;
    type: OutboxType;
    deduplicationKey: string;
    payload: any;
    status: OutboxStatus;
    attempts: number;
    maxAttempts: number;
    fencingToken: number;
    availableAt: Date;
    processingStartedAt: Date | null;
    completedAt: Date | null;
    lastError: string | null;
    leaseUntil: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

// In-memory outbox store backed by UNIQUE(type, deduplicationKey) constraint index
const outboxStore = new Map<string, OutboxRecord>();

function getDeduplicationIndexKey(type: OutboxType, deduplicationKey: string): string {
    return `${type}:${deduplicationKey}`;
}

export async function enqueueOutboxJob(
    type: OutboxType,
    deduplicationKey: string,
    payload: any,
    options: { availableAt?: Date; maxAttempts?: number; tx?: any } = {}
): Promise<{ record: OutboxRecord; isDuplicate: boolean }> {
    const indexKey = getDeduplicationIndexKey(type, deduplicationKey);
    const existing = outboxStore.get(indexKey);

    if (existing) {
        logger.info("[OutboxEngine] Duplicate outbox job skipped via UNIQUE(type, deduplicationKey)", {
            type,
            deduplicationKey,
            existingStatus: existing.status
        });
        return { record: existing, isDuplicate: true };
    }

    const now = new Date();
    const record: OutboxRecord = {
        id: `outbox-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type,
        deduplicationKey,
        payload,
        status: "PENDING",
        attempts: 0,
        maxAttempts: options.maxAttempts ?? 5,
        fencingToken: 1,
        availableAt: options.availableAt ?? now,
        processingStartedAt: null,
        completedAt: null,
        lastError: null,
        leaseUntil: null,
        createdAt: now,
        updatedAt: now
    };

    outboxStore.set(indexKey, record);
    logger.info("[OutboxEngine] Enqueued durable outbox job", { type, deduplicationKey, id: record.id });
    return { record, isDuplicate: false };
}

export async function processOutboxBatch(
    type: OutboxType,
    quotaLimit: number,
    workerFn: (record: OutboxRecord) => Promise<boolean>,
    options: { leaseDurationMs?: number } = {}
): Promise<{ processed: number; succeeded: number; failed: number; rateLimited: number }> {
    const now = new Date();
    const leaseDurationMs = options.leaseDurationMs ?? 60000;

    // Find eligible jobs: status === PENDING AND availableAt <= now OR expired lease (processingStartedAt && leaseUntil < now)
    const eligibleRecords = Array.from(outboxStore.values()).filter((rec) => {
        if (rec.type !== type) return false;
        if (rec.status === "COMPLETED" || rec.status === "FAILED") return false;

        const isAvailable = rec.availableAt <= now;
        const isLeaseExpired = rec.status === "PROCESSING" && rec.leaseUntil !== null && rec.leaseUntil < now;

        return isAvailable && (rec.status === "PENDING" || isLeaseExpired);
    });

    // Enforce quota limit (dispatch at most quotaLimit jobs)
    const batchToProcess = eligibleRecords.slice(0, quotaLimit);
    let succeeded = 0;
    let failed = 0;
    let rateLimited = 0;

    for (const record of batchToProcess) {
        // Claim job lease atomically and increment fencing token
        record.fencingToken += 1;
        const currentFencingToken = record.fencingToken;
        record.status = "PROCESSING";
        record.attempts += 1;
        record.processingStartedAt = new Date();
        record.leaseUntil = new Date(Date.now() + leaseDurationMs);
        record.updatedAt = new Date();

        try {
            const success = await workerFn(record);

            // Fencing Token Validation: Reject completion from stale worker if token changed
            if (record.fencingToken !== currentFencingToken) {
                logger.warn("[OutboxEngine] Stale worker completion rejected due to fencing token mismatch", {
                    id: record.id,
                    workerToken: currentFencingToken,
                    latestToken: record.fencingToken
                });
                continue;
            }

            if (success) {
                record.status = "COMPLETED";
                record.completedAt = new Date();
                record.leaseUntil = null;
                succeeded += 1;
            } else {
                failed += 1;
                handleJobFailure(record, "Worker returned failure status");
            }
        } catch (err: any) {
            if (record.fencingToken !== currentFencingToken) {
                continue; // Ignore stale worker error handler
            }
            const isRateLimit = err?.status === 429 || String(err?.message).includes("429");
            if (isRateLimit) {
                rateLimited += 1;
                // Back off without burning max attempts rapidly
                record.status = "PENDING";
                record.lastError = "HTTP 429 Too Many Requests";
                record.availableAt = new Date(Date.now() + 60000); // Wait 60s
                record.leaseUntil = null;
            } else {
                failed += 1;
                handleJobFailure(record, err?.message || String(err));
            }
        }
    }

    return { processed: batchToProcess.length, succeeded, failed, rateLimited };
}

function handleJobFailure(record: OutboxRecord, errorMessage: string): void {
    record.lastError = errorMessage;
    record.leaseUntil = null;
    if (record.attempts >= record.maxAttempts) {
        record.status = "FAILED";
        logger.error("[OutboxEngine] Outbox job reached max attempts — moved to FAILED (DLQ candidate)", {
            id: record.id,
            type: record.type,
            attempts: record.attempts
        });
    } else {
        record.status = "PENDING";
        // Exponential backoff: 2^attempts * 5 seconds
        const backoffMs = Math.pow(2, record.attempts) * 5000;
        record.availableAt = new Date(Date.now() + backoffMs);
    }
}

export function clearOutboxStore(): void {
    outboxStore.clear();
}

export function getOutboxRecord(type: OutboxType, deduplicationKey: string): OutboxRecord | undefined {
    return outboxStore.get(getDeduplicationIndexKey(type, deduplicationKey));
}

export function getOutboxStats(): { total: number; pending: number; processing: number; completed: number; failed: number } {
    const all = Array.from(outboxStore.values());
    return {
        total: all.length,
        pending: all.filter(r => r.status === "PENDING").length,
        processing: all.filter(r => r.status === "PROCESSING").length,
        completed: all.filter(r => r.status === "COMPLETED").length,
        failed: all.filter(r => r.status === "FAILED").length,
    };
}
