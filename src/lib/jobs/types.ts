export type JobType =
    | "AEO_SCAN"
    | "SEO_AUDIT"
    | "CONTENT_GEN"
    | "CONTENT_REFRESH"
    | "AUTO_HEAL_PR"
    | "INDEXING";

export type JobStatus =
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";

export interface JobResult {
    score?: number;
    grade?: string;
    reportId?: string;
    issueCount?: number;
    url?: string;
}

export interface JobStatusResponse {
    id: string;
    type: JobType;
    status: JobStatus;
    title: string;
    progressPct: number;
    startedAt?: string;
    completedAt?: string;
    targetHref?: string;
    error?: string;
    result?: JobResult;
}

export interface ActiveJobsApiResponse {
    jobs: JobStatusResponse[];
    hasActiveJobs: boolean;
}
