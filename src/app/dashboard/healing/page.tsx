import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Self-Healing Log | OptiAISEO",
  description: "Full audit trail of automated SEO fixes applied by the self-healing engine.",
};

export const dynamic = "force-dynamic";

export default async function HealingRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const resolvedParams = await searchParams;
  let siteId = resolvedParams.siteId;

  if (!siteId && session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (user) {
      const firstSite = await prisma.site.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      siteId = firstSite?.id;
    }
  }

  if (siteId) {
    redirect(`/dashboard/sites/${siteId}/healing-log`);
  }

  redirect("/dashboard/sites");
}
