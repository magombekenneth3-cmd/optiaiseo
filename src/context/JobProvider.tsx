"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { JobStatusResponse } from "@/lib/jobs/types";
import { toast } from "sonner";

interface JobContextType {
    jobs: JobStatusResponse[];
    activeJobs: JobStatusResponse[];
    trackJob: (jobId: string) => void;
    refreshJobs: () => Promise<void>;
}

const JobContext = createContext<JobContextType>({
    jobs: [],
    activeJobs: [],
    trackJob: () => {},
    refreshJobs: async () => {},
});

const STORAGE_KEY = "optiaiseo_active_job_ids";
const POLL_INTERVAL_MS = 3000;

export function JobProvider({ children }: { children: React.ReactNode }) {
    const [jobs, setJobs] = useState<JobStatusResponse[]>([]);
    const previousJobStatusMap = useRef<Map<string, string>>(new Map());

    const refreshJobs = useCallback(async () => {
        try {
            const res = await fetch("/api/jobs/active", { cache: "no-store" });
            if (!res.ok) return;

            const data = await res.json() as { jobs: JobStatusResponse[] };
            const fetchedJobs = data.jobs ?? [];

            // Detect state transitions (running -> completed / failed) for notifications
            for (const job of fetchedJobs) {
                const prevStatus = previousJobStatusMap.current.get(job.id);
                if (prevStatus && prevStatus !== job.status) {
                    if (job.status === "completed") {
                        toast.success(`${job.title} completed!`, {
                            description: job.result?.score ? `Score: ${job.result.score}/100` : "View results now.",
                            action: job.targetHref ? {
                                label: "View",
                                onClick: () => window.location.href = job.targetHref!,
                            } : undefined,
                        });
                    } else if (job.status === "failed") {
                        toast.error(`${job.title} failed`, {
                            description: job.error ?? "An unexpected error occurred during processing.",
                        });
                    }
                }
                previousJobStatusMap.current.set(job.id, job.status);
            }

            setJobs(fetchedJobs);

            // Persist lightweight observed job IDs in localStorage
            if (typeof window !== "undefined") {
                const activeIds = fetchedJobs
                    .filter(j => j.status === "queued" || j.status === "running")
                    .map(j => j.id);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(activeIds));
            }
        } catch {
            // Non-fatal background fetch error
        }
    }, []);

    const trackJob = useCallback((jobId: string) => {
        if (!jobId) return;
        if (typeof window !== "undefined") {
            try {
                const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
                if (!existing.includes(jobId)) {
                    existing.push(jobId);
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
                }
            } catch {
                /* non-fatal */
            }
        }
        refreshJobs();
    }, [refreshJobs]);

    // Initial hydration
    useEffect(() => {
        refreshJobs();
    }, [refreshJobs]);

    // Intelligent polling: poll ONLY when active jobs exist
    const activeJobs = jobs.filter(j => j.status === "queued" || j.status === "running");

    useEffect(() => {
        if (activeJobs.length === 0) return;

        const timer = setInterval(() => {
            refreshJobs();
        }, POLL_INTERVAL_MS);

        return () => clearInterval(timer);
    }, [activeJobs.length, refreshJobs]);

    return (
        <JobContext.Provider value={{ jobs, activeJobs, trackJob, refreshJobs }}>
            {children}
        </JobContext.Provider>
    );
}

export function useJobManager() {
    return useContext(JobContext);
}
