export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { logger }                    from "@/lib/logger";
import prisma                        from "@/lib/prisma";
import { runAeoAudit }               from "@/lib/aeo";
import { rateLimit }                 from "@/lib/rate-limit";

async function authenticate(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const user = await prisma.user.findFirst({
    where:  { wpApiKey: token },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function POST(req: NextRequest) {
  const userId = await authenticate(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized — invalid API key" }, { status: 401 });
  }

  const limited = await rateLimit("wpPlugin", userId);
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const { siteId, postUrl, postId } = body as {
    siteId?:  string;
    postUrl?: string;
    postId?:  number;
  };

  if (!siteId || !postUrl) {
    return NextResponse.json({ error: "siteId and postUrl are required" }, { status: 400 });
  }

  const site = await prisma.site.findFirst({
    where:  { id: siteId, userId },
    select: { id: true, domain: true, coreServices: true },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  try {
    const result = await runAeoAudit(postUrl, site.coreServices, true);

    const suggestedSchemaHtml = buildSuggestedSchema(postUrl, result.schemaGaps ?? []);

    await prisma.aeoReport.create({
      data: {
        siteId,
        score:                  result.score,
        grade:                  result.grade,
        citationScore:          result.citationScore,
        citationLikelihood:     result.citationLikelihood,
        generativeShareOfVoice: result.generativeShareOfVoice,
        schemaTypes:            result.schemaTypes,
        checks:                 result.checks as object,
        topRecommendations:     result.topRecommendations,
        multiModelResults:      result.multiModelResults as object,
      },
    });

    const failedChecks = result.checks
      .filter((c) => !c.passed)
      .map((c) => ({ id: c.id, label: c.label, category: c.category, impact: c.impact }));

    logger.info("[WP/PostScore] Computed", { siteId, postUrl, postId, score: result.score });

    return NextResponse.json({
      aeoScore:               result.score,
      grade:                  result.grade,
      generativeShareOfVoice: result.generativeShareOfVoice,
      citationLikelihood:     result.citationLikelihood,
      failedChecks,
      suggestedSchemaHtml,
      schemaTypes:            result.schemaTypes,
      topRecommendations:     result.topRecommendations.slice(0, 5),
      checkedAt:              new Date().toISOString(),
    });
  } catch (err: unknown) {
    logger.error("[WP/PostScore] Failed", { siteId, postUrl, error: (err as Error)?.message });
    return NextResponse.json({ error: "Score computation failed. Try again later." }, { status: 500 });
  }
}

function buildSuggestedSchema(url: string, schemaGaps: string[]): string {
  const blocks: object[] = [];
  const origin     = (() => { try { return new URL(url).origin; } catch { return ""; } })();
  const hasFaqGap  = schemaGaps.some((g) => g.includes("FAQPage"));
  const isArticle  = /\/blog\/|\/post\/|\/\d{4}\//i.test(url);

  if (isArticle || schemaGaps.some((g) => g.includes("Article") || g.includes("BlogPosting"))) {
    blocks.push({
      "@context": "https://schema.org",
      "@type":    "BlogPosting",
      "@id":      url,
      url,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      inLanguage: "en",
      publisher:  { "@type": "Organization", name: "{{SITE_NAME}}", url: origin },
    });
  }

  if (hasFaqGap) {
    blocks.push({
      "@context":   "https://schema.org",
      "@type":      "FAQPage",
      mainEntity: [
        {
          "@type":          "Question",
          name:             "{{FAQ_QUESTION_1}}",
          acceptedAnswer: { "@type": "Answer", text: "{{FAQ_ANSWER_1}}" },
        },
        {
          "@type":          "Question",
          name:             "{{FAQ_QUESTION_2}}",
          acceptedAnswer: { "@type": "Answer", text: "{{FAQ_ANSWER_2}}" },
        },
      ],
    });
  }

  blocks.push({
    "@context":       "https://schema.org",
    "@type":          "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: origin },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${origin}/blog` },
      { "@type": "ListItem", position: 3, name: "{{THIS_PAGE_TITLE}}", item: url },
    ],
  });

  return blocks
    .map((b) => `<script type="application/ld+json">\n${JSON.stringify(b, null, 2)}\n</script>`)
    .join("\n");
}
