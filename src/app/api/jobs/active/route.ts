import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserActiveJobs } from "@/lib/jobs/job-repository";
import "@/lib/server-only";

export const dynamic = "force-dynamic";

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ jobs: [], hasActiveJobs: false }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
    });

    if (!dbUser) {
        return NextResponse.json({ jobs: [], hasActiveJobs: false });
    }

    const jobs = await getUserActiveJobs(dbUser.id);

    return NextResponse.json({
        jobs,
        hasActiveJobs: jobs.length > 0,
    });
}
