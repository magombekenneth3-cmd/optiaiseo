import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AutopilotDashboard } from "@/components/dashboard/AutopilotDashboard";

export const metadata: Metadata = {
  title: "Autopilot Command Center | OptiAISEO",
  description:
    "AI-driven SEO optimization pipeline — discovery, scoring, planning, enhancement, authorization, and execution in one view.",
};

export const dynamic = "force-dynamic";

export default async function AutopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const { siteId } = await searchParams;

  // Validate siteId and redirect to first site if needed
  const CUID_RE = /^[a-z0-9]{10,40}$/i;

  if (!siteId || !CUID_RE.test(siteId)) {
    const firstSite = await prisma.site.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (firstSite) {
      redirect(`/dashboard/autopilot?siteId=${firstSite.id}`);
    }
    redirect("/dashboard/settings");
  }

  // Verify site ownership
  const site = await prisma.site.findFirst({
    where: {
      id: siteId,
      OR: [
        { userId: session.user.id },
        { viewerId: session.user.id },
      ],
    },
    select: { id: true, domain: true },
  });

  if (!site) redirect("/dashboard");

  return (
    <div className="p-2 sm:p-4 lg:p-6 flex flex-col gap-6">
      <AutopilotDashboard />
    </div>
  );
}
