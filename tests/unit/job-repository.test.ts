import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock prisma before importing job-repository
vi.mock("@/lib/prisma", () => {
    return {
        prisma: {
            site: {
                findMany: vi.fn(),
            },
            aeoReport: {
                findMany: vi.fn(),
                findUnique: vi.fn(),
            },
            audit: {
                findMany: vi.fn(),
                findUnique: vi.fn(),
            },
            competitorPageAnalysis: {
                findMany: vi.fn(),
                findUnique: vi.fn(),
            },
        },
    };
});

import { prisma } from "@/lib/prisma";
import { getUserActiveJobs, getJobByIdForUser } from "@/lib/jobs/job-repository";

describe("JobRepository Adapter & Security Authorization", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should return empty array if user has no sites", async () => {
        vi.mocked(prisma.site.findMany).mockResolvedValue([]);
        const jobs = await getUserActiveJobs("user-1");
        expect(jobs).toEqual([]);
    });

    it("should format active AEO reports into JobStatusResponse array", async () => {
        vi.mocked(prisma.site.findMany).mockResolvedValue([
            { id: "site-1", domain: "example.com" } as never,
        ]);
        vi.mocked(prisma.aeoReport.findMany).mockResolvedValue([
            {
                id: "report-100",
                siteId: "site-1",
                status: "RUNNING",
                createdAt: new Date("2026-08-11T12:00:00Z"),
            } as never,
        ]);
        vi.mocked(prisma.audit.findMany).mockResolvedValue([]);
        vi.mocked(prisma.competitorPageAnalysis.findMany).mockResolvedValue([]);

        const jobs = await getUserActiveJobs("user-1");
        expect(jobs.length).toBe(1);
        expect(jobs[0]).toEqual({
            id: "aeo-report-100",
            type: "AEO_SCAN",
            status: "running",
            title: "AEO Audit — example.com",
            progressPct: 65,
            startedAt: "2026-08-11T12:00:00.000Z",
            targetHref: "/dashboard/aeo?siteId=site-1",
        });
    });

    it("should ENFORCE USER OWNERSHIP: return null when a user tries to access another user's job ID", async () => {
        // User 2 owns site-2
        vi.mocked(prisma.site.findMany).mockResolvedValue([
            { id: "site-2", domain: "user2-site.com" } as never,
        ]);
        // Job report-999 belongs to site-1 (User 1's site)
        vi.mocked(prisma.aeoReport.findUnique).mockResolvedValue({
            id: "report-999",
            siteId: "site-1",
            status: "RUNNING",
            createdAt: new Date(),
            site: { userId: "user-1", domain: "user1-site.com" },
        } as never);

        // User 2 attempts to query report-999
        const result = await getJobByIdForUser("user-2", "aeo-report-999");
        expect(result).toBeNull();
    });

    it("should return completed job status and result payload for legitimate site owner", async () => {
        vi.mocked(prisma.site.findMany).mockResolvedValue([
            { id: "site-1", domain: "example.com" } as never,
        ]);
        vi.mocked(prisma.aeoReport.findUnique).mockResolvedValue({
            id: "report-100",
            siteId: "site-1",
            status: "COMPLETED",
            score: 88,
            grade: "A",
            createdAt: new Date("2026-08-11T12:00:00Z"),
            site: { userId: "user-1", domain: "example.com" },
        } as never);

        const result = await getJobByIdForUser("user-1", "aeo-report-100");
        expect(result).not.toBeNull();
        expect(result?.status).toBe("completed");
        expect(result?.result?.score).toBe(88);
        expect(result?.result?.grade).toBe("A");
    });

    it("should ENFORCE ACTIVE JOBS ISOLATION: getUserActiveJobs must only query sites owned by user", async () => {
        vi.mocked(prisma.site.findMany).mockResolvedValue([
            { id: "user1-site-A", domain: "site-a.com" } as never,
        ]);
        vi.mocked(prisma.aeoReport.findMany).mockResolvedValue([]);
        vi.mocked(prisma.audit.findMany).mockResolvedValue([]);
        vi.mocked(prisma.competitorPageAnalysis.findMany).mockResolvedValue([]);

        await getUserActiveJobs("user-1");

        expect(prisma.aeoReport.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    siteId: { in: ["user1-site-A"] },
                }),
            })
        );
    });
});
