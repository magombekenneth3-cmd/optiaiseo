export type GenerationOutboxRow = {
    id: string;
    generationAttemptId: string | null;
    generationInput: unknown;
};

export type GenerationOutboxResult = "dispatched" | "skipped";

export function blogGenerationEventId(blogId: string, attemptId: string): string {
    return `blog-generation:${blogId}:${attemptId}`;
}

export async function replayGenerationOutbox(
    row: GenerationOutboxRow,
    deps: {
        ensureCharge: (userId: string, referenceId: string) => Promise<boolean>;
        dispatch: (eventId: string, data: Record<string, unknown>) => Promise<void>;
        markFailed: (blogId: string, attemptId: string, message: string) => Promise<void>;
    },
): Promise<GenerationOutboxResult> {
    const payload = row.generationInput;
    if (
        !row.generationAttemptId ||
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        typeof (payload as Record<string, unknown>).userId !== "string"
    ) {
        if (row.generationAttemptId) {
            await deps.markFailed(row.id, row.generationAttemptId, "Generation request payload is unavailable; please retry.");
        }
        return "skipped";
    }

    const attemptId = row.generationAttemptId;
    const userId = (payload as Record<string, unknown>).userId as string;
    const creditReference = blogGenerationEventId(row.id, attemptId);
    if (!(await deps.ensureCharge(userId, creditReference))) {
        await deps.markFailed(row.id, attemptId, "Generation could not be charged; please retry.");
        return "skipped";
    }

    await deps.dispatch(blogGenerationEventId(row.id, attemptId), {
        ...(payload as Record<string, unknown>),
        attemptId,
    });
    return "dispatched";
}
