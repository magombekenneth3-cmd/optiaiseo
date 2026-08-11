import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { performOneClickAutoFix, AutoFixOptions } from "@/lib/autofix/fixer";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { rawHtml, targetUrl, options } = body as {
            rawHtml: string;
            targetUrl: string;
            options?: AutoFixOptions;
        };

        if (!rawHtml || !targetUrl) {
            return NextResponse.json({ error: "Missing required fields: rawHtml and targetUrl" }, { status: 400 });
        }

        const result = performOneClickAutoFix(rawHtml, targetUrl, options);

        return NextResponse.json({
            success: true,
            targetUrl,
            totalFixesApplied: result.changes.length,
            changes: result.changes,
            fixedHtml: result.fixedHtml,
        });
    } catch (err: unknown) {
        const error = err instanceof Error ? err.message : "One-click auto-fix execution failed";
        return NextResponse.json({ error }, { status: 500 });
    }
}
