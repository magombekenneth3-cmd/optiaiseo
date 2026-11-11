export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sites = await prisma.site.findMany({
    where: {
      OR: [
        { aeoAutopilotEnabled: true },
        { operatingMode: "AUTOPILOT" },
      ],
      user: { subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] } },
    },
    select: { id: true, domain: true, userId: true, aeoAutopilotSchedule: true },
  });

  const today = new Date();
  const dayOfWeek = today.getDay();
  const dayOfMonth = today.getDate();

  const due = sites.filter((s) => {
    if (s.aeoAutopilotSchedule === "daily") return true;
    if (s.aeoAutopilotSchedule === "weekly") return dayOfWeek === 1;
    if (s.aeoAutopilotSchedule === "biweekly") return dayOfWeek === 1 && dayOfMonth <= 14;
    return false;
  });

  let queuedCount = 0;

  if (due.length > 0) {
    const staleCutoff = new Date(Date.now() - 10 * 60 * 1000);
    const eventsToSend: {
      name: "aeo.audit.run";
      data: { siteId: string; reportId: string; userId: string; autopilot: boolean };
    }[] = [];

    for (const site of due) {
      const existingPending = await prisma.aeoReport.findFirst({
        where: { siteId: site.id, status: "PENDING", createdAt: { gte: staleCutoff } },
        select: { id: true },
      });
      if (existingPending) continue;

      const report = await prisma.aeoReport.create({
        data: {
          siteId: site.id,
          status: "PENDING",
          score: 0,
          grade: "Pending",
          citationScore: 0,
          generativeShareOfVoice: 0,
          citationLikelihood: 0,
          schemaTypes: [],
          checks: {
            status: "Scheduled autopilot AEO audit in progress.",
          } as object,
          topRecommendations: ["Audit in progress..."],
        },
        select: { id: true },
      });

      eventsToSend.push({
        name: "aeo.audit.run" as const,
        data: { siteId: site.id, reportId: report.id, userId: site.userId, autopilot: true },
      });
    }

    if (eventsToSend.length > 0) {
      await inngest.send(eventsToSend);
      queuedCount = eventsToSend.length;
    }
  }

  return NextResponse.json({ success: true, evaluated: sites.length, queued: queuedCount });
}
