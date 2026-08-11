import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { validateRichResultsWithGoogleApi, autoFixSchemaMarkup } from "@/lib/schema/rich-results-validator";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { url, rawHtml, schemaJson, autoFix = true } = body as {
            url: string;
            rawHtml?: string;
            schemaJson?: string;
            autoFix?: boolean;
        };

        if (!url && !rawHtml && !schemaJson) {
            return NextResponse.json({ error: "Missing required payload: url, rawHtml, or schemaJson" }, { status: 400 });
        }

        const validationReport = await validateRichResultsWithGoogleApi(url || "https://example.com", rawHtml);

        let fixedSchemaResult: { fixedJson: string; fixesApplied: string[] } | undefined = undefined;
        if (autoFix && schemaJson) {
            fixedSchemaResult = autoFixSchemaMarkup(schemaJson);
        }

        return NextResponse.json({
            success: true,
            report: validationReport,
            autoFixResult: fixedSchemaResult,
        });
    } catch (err: unknown) {
        const error = err instanceof Error ? err.message : "Rich Results pre-flight validation failed";
        return NextResponse.json({ error }, { status: 500 });
    }
}
