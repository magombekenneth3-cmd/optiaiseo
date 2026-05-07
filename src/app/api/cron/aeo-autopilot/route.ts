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
      aeoAutopilotEnabled: true,
      user: { subscriptionTier: { in: ["PRO", "AGENCY"] } },
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

  if (due.length > 0) {
    await inngest.send(
      due.map((site) => ({
        name: "aeo.audit.run" as const,
        data: { siteId: site.id, userId: site.userId, autopilot: true },
      }))
    );
  }

  return NextResponse.json({ success: true, evaluated: sites.length, queued: due.length });
}
