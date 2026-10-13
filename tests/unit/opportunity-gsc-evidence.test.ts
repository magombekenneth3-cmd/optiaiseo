import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getUserGscToken } from "@/lib/gsc/token";
import { getAuthorizedGscProperty } from "@/lib/gsc/property-resolver";
import { fetchGSCKeywords } from "@/lib/gsc";
import { fetchGscEvidenceResult } from "@/lib/opportunity-engine/evidence";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    site: { findUnique: vi.fn() },
    gscDailyPerformance: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("@/lib/gsc/token", () => ({
  getUserGscToken: vi.fn(),
}));

vi.mock("@/lib/gsc/property-resolver", () => ({
  getAuthorizedGscProperty: vi.fn(),
}));

vi.mock("@/lib/gsc", () => ({
  fetchGSCKeywords: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const site = { id: "site-1", domain: "example.com", userId: "user-1" };
const recentDates = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-10-${String(10 - index).padStart(2, "0")}`,
}));

describe("fetchGscEvidenceResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site as never);
    vi.mocked(prisma.gscDailyPerformance.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.gscDailyPerformance.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.gscDailyPerformance.groupBy).mockResolvedValue([] as never);
    vi.mocked(getUserGscToken).mockRejectedValue(new Error("GSC_NOT_CONNECTED"));
    vi.mocked(getAuthorizedGscProperty).mockResolvedValue("https://example.com" as never);
    vi.mocked(fetchGSCKeywords).mockResolvedValue([] as never);
  });

  it("returns NOT_CONNECTED with null data instead of pretending GSC returned no rows", async () => {
    const result = await fetchGscEvidenceResult("site-1");

    expect(result.status).toBe("NOT_CONNECTED");
    expect(result.data).toBeNull();
    expect(result.source).toBe("NONE");
  });

  it("marks old stored history as STALE when the live refresh also fails", async () => {
    vi.mocked(prisma.gscDailyPerformance.findFirst).mockResolvedValue({
      date: "2025-01-01",
    } as never);

    const result = await fetchGscEvidenceResult("site-1");

    expect(result.status).toBe("STALE");
    expect(result.fallbackStatus).toBe("NOT_CONNECTED");
    expect(result.data).toBeNull();
  });



  it("does not reuse seven historical days when the newest persisted observation is stale", async () => {
    vi.mocked(prisma.gscDailyPerformance.findMany).mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({
        date: `2026-09-${String(20 - index).padStart(2, "0")}`,
      })) as never,
    );
    vi.mocked(prisma.gscDailyPerformance.findFirst).mockResolvedValue({
      date: "2026-09-20",
    } as never);

    const result = await fetchGscEvidenceResult("site-1");

    expect(result.status).toBe("STALE");
    expect(result.fallbackStatus).toBe("NOT_CONNECTED");
    expect(result.data).toBeNull();
    expect(prisma.gscDailyPerformance.groupBy).not.toHaveBeenCalled();
  });

  it("reports insufficient recent history separately from stale stored history", async () => {
    vi.mocked(prisma.gscDailyPerformance.findMany).mockResolvedValue(
      recentDates.slice(0, 3) as never,
    );
    vi.mocked(prisma.gscDailyPerformance.findFirst).mockResolvedValue({
      date: "2026-10-10",
    } as never);

    const result = await fetchGscEvidenceResult("site-1");

    expect(result.status).toBe("INSUFFICIENT_HISTORY");
    expect(result.fallbackStatus).toBe("NOT_CONNECTED");
    expect(result.data).toBeNull();
  });

  it("uses recent persisted history and reports the actual source and date", async () => {
    vi.mocked(prisma.gscDailyPerformance.findMany).mockResolvedValue(recentDates as never);
    vi.mocked(prisma.gscDailyPerformance.findFirst).mockResolvedValue({
      date: "2026-10-12",
    } as never);
    vi.mocked(prisma.gscDailyPerformance.groupBy)
      .mockResolvedValueOnce([
        {
          url: "https://example.com/page",
          keyword: "seo tool",
          _sum: { clicks: 7, impressions: 100 },
          _avg: { position: 8.2 },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const result = await fetchGscEvidenceResult("site-1");

    expect(result.status).toBe("AVAILABLE");
    expect(result.source).toBe("PERSISTED_DB");
    expect(result.observedAt).toBe("2026-10-10");
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].keyword).toBe("seo tool");
  });

  it("distinguishes an authoritative empty live query from a failed connection", async () => {
    vi.mocked(getUserGscToken).mockResolvedValue("access-token" as never);
    vi.mocked(fetchGSCKeywords).mockResolvedValue([] as never);

    const result = await fetchGscEvidenceResult("site-1");

    expect(result.status).toBe("NO_DATA");
    expect(result.data).toEqual([]);
    expect(result.source).toBe("LIVE_GSC");
    expect(result.dateRange).not.toBeNull();
    const from = new Date(result.dateRange!.from).getTime();
    const to = new Date(result.dateRange!.to).getTime();
    expect((to - from) / (24 * 60 * 60 * 1000)).toBe(89);
    expect(fetchGSCKeywords).toHaveBeenCalledTimes(1);
  });

  it("does not treat a deleted site as a zero-result GSC query", async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(null as never);

    const result = await fetchGscEvidenceResult("missing-site");

    expect(result.status).toBe("SITE_NOT_FOUND");
    expect(result.data).toBeNull();
    expect(getUserGscToken).not.toHaveBeenCalled();
  });
});
