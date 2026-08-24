import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PseoDashboardClient from "./PseoDashboard";

export const metadata: Metadata = {
    title: "Programmatic SEO | OptiAISEO",
    description: "Generate hundreds of location, service, or product landing pages with AI at scale.",
};

export const dynamic = "force-dynamic";

export default async function PseoPage() {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    const sites = userId
        ? await prisma.site.findMany({
            where: { userId },
            select: { id: true, domain: true },
            orderBy: { createdAt: "asc" },
        })
        : [];

    return <PseoDashboardClient sites={sites} />;
}
