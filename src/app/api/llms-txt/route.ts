import { NextRequest, NextResponse } from "next/server";
import {
  generateLlmsTxtByDomain,
  normalizeDomainLookup,
} from "@/lib/aeo/llms-txt-generator";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Public hosted `/api/llms-txt?domain=example.com[&format=full][&download=1]` endpoint.
 * Serves the consolidated full-site llms.txt or llms-full.txt document generated from
 * crawled PageAudits, published Blogs, BrandFacts, FAQ schema, GSC queries, and AEO reports.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawDomain = searchParams.get("domain")?.trim();
  const format = searchParams.get("format")?.toLowerCase().trim();
  const downloadParam = searchParams.get("download")?.toLowerCase().trim();

  if (!rawDomain) {
    return new NextResponse(
      "Error: ?domain= parameter is required. Example: /api/llms-txt?domain=example.com",
      {
        status: 400,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Robots-Tag": "noindex",
        },
      },
    );
  }

  const normalizedHost = normalizeDomainLookup(rawDomain);
  if (!normalizedHost || !normalizedHost.includes(".")) {
    return new NextResponse(
      "Error: Please provide a valid domain name. Example: /api/llms-txt?domain=example.com",
      {
        status: 400,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Robots-Tag": "noindex",
        },
      },
    );
  }

  const isFull = format === "full";
  const isDownload = downloadParam === "1" || downloadParam === "true";

  try {
    const result = await generateLlmsTxtByDomain(normalizedHost, { full: isFull });

    if (!result) {
      return new NextResponse(
        `Error: No site found for "${normalizedHost}". Add your domain to RankPulse first.`,
        {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Robots-Tag": "noindex",
          },
        },
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": isDownload
        ? "private, no-store"
        : "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    };

    if (isDownload) {
      const filename = isFull ? "llms-full.txt" : "llms.txt";
      headers["Content-Disposition"] = `attachment; filename="${filename}"`;
    }

    return new NextResponse(result.content, {
      status: 200,
      headers,
    });
  } catch (error) {
    logger.error("[api/llms-txt] Failed to generate llms.txt", {
      domain: normalizedHost,
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse(
      "Error: Unable to generate llms.txt right now. Please try again later.",
      {
        status: 500,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Robots-Tag": "noindex",
        },
      },
    );
  }
}
