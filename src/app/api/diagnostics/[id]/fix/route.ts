import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getFixRequirements, pushAuditFixPR, triggerAutoFix } from "@/app/actions/auditFix";
import { hasDeterministicFix, tryDeterministicFix, type FixResult as DeterministicFixResult } from "@/lib/seo-audit/deterministic-fixes";
import { matchDiagnosticCause, resolveVerificationTargetUrl } from "@/lib/seo-audit/live-verify";
import { LIFECYCLE_STATE, transitionLifecycleState } from "@/lib/seo-audit/lifecycle";

export const dynamic = "force-dynamic";

type FixActionKind = "requirements" | "generate" | "push_pr";

function mapDeterministicToManualGuide(
  detFix: DeterministicFixResult,
  targetUrl: string,
) {
  const language =
    detFix.astLanguage === "typescript" ||
    detFix.astLanguage === "javascript" ||
    detFix.astLanguage === "jsx"
      ? detFix.astLanguage
      : detFix.astLanguage === "json"
        ? "json"
        : detFix.astLanguage === "mdx"
          ? "mdx"
          : detFix.astLanguage === "llms_txt" || detFix.astLanguage === "robots"
            ? "text"
            : "html";

  const locationHint = detFix.filePath
    ? `Update or create \`${detFix.filePath}\` with the snippet below.`
    : detFix.targetSelector
      ? `Insert or update inside \`<${detFix.targetSelector}>\` for ${targetUrl}.`
      : `Apply the snippet below on ${targetUrl}.`;

  return {
    steps: [
      detFix.description,
      locationHint,
      detFix.impactLabel,
      "Deploy your changes to production, then click \"Verify Fix Live\" to confirm.",
    ],
    codeSnippet: detFix.patch ?? undefined,
    filePath: detFix.filePath ?? (detFix.targetSelector ? `HTML <${detFix.targetSelector}>` : undefined),
    language,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email && !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: findingId } = await params;
  if (!findingId || findingId.length > 50) {
    return NextResponse.json({ error: "Invalid finding ID" }, { status: 400 });
  }

  const user = session.user.email
    ? await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
      })
    : { id: session.user.id! };

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const rateLimitResult = await checkRateLimit(`finding-fix:${user.id}:${findingId}`, 10, 60);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: "Too many fix requests. Please wait a minute before retrying." },
      { status: 429 },
    );
  }

  const finding = await prisma.diagnosticFindingRecord.findUnique({
    where: { id: findingId },
    select: {
      id: true,
      siteId: true,
      fingerprint: true,
      issueType: true,
      status: true,
      scopeType: true,
      scopeUrls: true,
      rootCause: true,
      expectedOutcome: true,
      remediationType: true,
      verificationCriteria: true,
      lifecycleState: true,
    },
  });

  if (!finding) {
    return NextResponse.json({ error: "Finding not found" }, { status: 404 });
  }

  const site = await prisma.site.findUnique({
    where: { id: finding.siteId },
    select: { id: true, userId: true, domain: true, githubRepoUrl: true },
  });

  if (!site || site.userId !== user.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let body: {
    action?: FixActionKind;
    extraContext?: Record<string, string>;
    proposalId?: string;
    url?: string;
  } = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === "object") {
      body = raw as typeof body;
    }
  } catch {
    // Allow empty JSON body (defaults to action: "generate")
  }

  const action: FixActionKind =
    body.action === "requirements" || body.action === "push_pr" ? body.action : "generate";

  const targetUrl = resolveVerificationTargetUrl(
    site.domain,
    finding.scopeUrls,
    typeof body.url === "string" && body.url.trim() ? body.url.trim() : undefined,
  );

  const matchedCause = matchDiagnosticCause(finding.issueType, finding.rootCause);
  const seoIssue = {
    id: matchedCause?.id ?? finding.issueType,
    checkId: finding.issueType,
    title: finding.issueType.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim(),
    description: finding.rootCause,
    category: finding.scopeType,
    recommendation: finding.expectedOutcome,
    url: targetUrl,
  };

  if (action === "requirements") {
    if (matchedCause && hasDeterministicFix(matchedCause.id)) {
      return NextResponse.json({
        success: true,
        action: "requirements",
        fields: [],
        deterministicAvailable: true,
      });
    }

    const reqRes = await getFixRequirements(site.domain, seoIssue);
    return NextResponse.json({
      success: reqRes.success,
      action: "requirements",
      fields: reqRes.fields ?? [],
      ...(reqRes.error ? { error: reqRes.error } : {}),
    });
  }

  if (action === "push_pr") {
    const proposalId = typeof body.proposalId === "string" ? body.proposalId.trim() : "";
    if (!proposalId) {
      return NextResponse.json({ error: "proposalId is required to push a PR." }, { status: 400 });
    }

    const pushRes = await pushAuditFixPR(site.id, proposalId);
    if (!pushRes.success) {
      return NextResponse.json({ error: pushRes.error }, { status: 400 });
    }

    // Ensure proposal is linked to this finding and advance finding lifecycle to IN_PROGRESS
    try {
      const proposalDelegate = (prisma as unknown as {
        seoFixProposal?: { updateMany: (args: Record<string, unknown>) => Promise<unknown> };
      }).seoFixProposal;
      if (typeof proposalDelegate?.updateMany === "function") {
        await proposalDelegate.updateMany({
          where: { id: proposalId, siteId: site.id },
          data: {
            diagnosticFindingId: finding.id,
            findingFingerprint: finding.fingerprint,
          },
        });
      }
    } catch {
      // Non-fatal metadata enrichment
    }

    let nextLifecycleState = finding.lifecycleState;
    if (
      finding.lifecycleState !== LIFECYCLE_STATE.IN_PROGRESS &&
      finding.lifecycleState !== LIFECYCLE_STATE.RESOLVED
    ) {
      const transition = await transitionLifecycleState(finding.id, LIFECYCLE_STATE.IN_PROGRESS);
      if (transition.success) {
        nextLifecycleState = transition.newState;
      }
    }

    return NextResponse.json({
      success: true,
      mode: "pr",
      prUrl: pushRes.prUrl,
      lifecycleState: nextLifecycleState,
    });
  }

  // action === "generate"
  const detFix = matchedCause
    ? tryDeterministicFix(matchedCause.id, {
        url: targetUrl,
        preferredUrl: targetUrl,
        domain: site.domain,
      })
    : null;

  // Without GitHub connected, return instant deterministic fix guide if available (zero AI latency)
  if (!site.githubRepoUrl && detFix?.patch) {
    return NextResponse.json({
      success: true,
      mode: "manual",
      deterministic: true,
      guide: mapDeterministicToManualGuide(detFix, targetUrl),
    });
  }

  const autoRes = await triggerAutoFix(
    site.id,
    site.domain,
    seoIssue,
    body.extraContext,
  );

  if (!autoRes.success) {
    if (detFix?.patch) {
      return NextResponse.json({
        success: true,
        mode: "manual",
        deterministic: true,
        guide: mapDeterministicToManualGuide(detFix, targetUrl),
      });
    }
    return NextResponse.json({ error: autoRes.error }, { status: 422 });
  }

  if (autoRes.mode === "review" && autoRes.proposalId) {
    try {
      const proposalDelegate = (prisma as unknown as {
        seoFixProposal?: { updateMany: (args: Record<string, unknown>) => Promise<unknown> };
      }).seoFixProposal;
      if (typeof proposalDelegate?.updateMany === "function") {
        await proposalDelegate.updateMany({
          where: { id: autoRes.proposalId, siteId: site.id },
          data: {
            diagnosticFindingId: finding.id,
            findingFingerprint: finding.fingerprint,
            ...(finding.verificationCriteria ? { verificationCriteria: finding.verificationCriteria } : {}),
          },
        });
      }
    } catch {
      // Non-fatal linking
    }
  }

  return NextResponse.json(autoRes);
}
