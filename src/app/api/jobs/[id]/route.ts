import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getJobByIdForUser } from "@/lib/jobs/job-repository";
import "@/lib/server-only";

export const dynamic = "force-dynamic";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
    });

    if (!dbUser) {
        return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const { id: jobId } = await params;
    if (!jobId) {
        return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    const job = await getJobByIdForUser(dbUser.id, jobId);

    if (!job) {
        return NextResponse.json({ error: "Job not found or access denied" }, { status: 404 });
    }

    return NextResponse.json(job);
}
