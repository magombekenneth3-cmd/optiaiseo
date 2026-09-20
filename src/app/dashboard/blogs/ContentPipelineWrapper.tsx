"use client";

import { useState, Suspense } from "react";
import { ContentPipeline, type PipelineFilter } from "./ContentPipeline";
import { BlogList } from "./BlogList";

/**
 * Client wrapper that holds the pipeline filter state and passes it
 * to both the ContentPipeline strip and the BlogList table.
 * page.tsx (server component) renders this instead of BlogList directly
 * when there is content to show.
 */
export function ContentPipelineWithList({
    counts,
    blogs,
    success,
    initialReviewId,
}: {
    counts: {
        total: number;
        writing: number;
        evidence: number;
        review: number;
        ready: number;
        published: number;
        issues: number;
    };
    blogs: any[];
    success: boolean;
    initialReviewId?: string;
}) {
    const [filter, setFilter] = useState<PipelineFilter>("ALL");

    return (
        <>
            <ContentPipeline
                counts={counts}
                activeFilter={filter}
                onFilterChange={setFilter}
            />
            <Suspense
                fallback={
                    <div className="space-y-4">
                        <div className="h-12 w-full animate-pulse rounded-xl bg-muted" />
                        <div className="h-[420px] w-full animate-pulse rounded-2xl bg-muted" />
                    </div>
                }
            >
                <BlogList
                    blogs={blogs}
                    success={success}
                    initialReviewId={initialReviewId}
                    pipelineFilter={filter}
                />
            </Suspense>
        </>
    );
}

/**
 * Standalone pipeline strip (without BlogList) — used when
 * page.tsx renders the pipeline above an empty state.
 */
export function ContentPipelineWrapper({
    counts,
}: {
    counts: {
        total: number;
        writing: number;
        evidence: number;
        review: number;
        ready: number;
        published: number;
        issues: number;
    };
}) {
    const [filter, setFilter] = useState<PipelineFilter>("ALL");

    return (
        <ContentPipeline
            counts={counts}
            activeFilter={filter}
            onFilterChange={setFilter}
        />
    );
}
