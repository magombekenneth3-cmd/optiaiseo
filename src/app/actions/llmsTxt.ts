"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { applyAstFixPlan } from "@/lib/ast/executor";
import type { AstFixPlan } from "@/lib/ast/types";
import { createAutoFixPR, getRepositoryFile, type AutoFixFile } from "@/lib/github";
import {
  generateLlmsTxtForSite,
  normalizeDomainLookup,
  type LlmsTxtGenerationStats,
} from "@/lib/aeo/llms-txt-generator";
import type { LlmsTxtCompliance } from "@/lib/seo-audit/llms-txt";
import { logger } from "@/lib/logger";

export interface LlmsTxtExportData {
  siteId: string;
  domain: string;
  brandName: string | null;
  githubRepoUrl: string | null;
  standardContent: string;
  fullContent: string;
  compliance: LlmsTxtCompliance;
  stats: LlmsTxtGenerationStats;
  hostedPath: string;
  hostedFullPath: string;
}

export type GetLlmsTxtExportDataResult =
  | { success: true; data: LlmsTxtExportData }
  | { success: false; error: string };

export type CreateLlmsTxtPRResult =
  | {
      success: true;
      prUrl?: string;
      alreadyUpToDate?: boolean;
      files: string[];
    }
  | { success: false; error: string };

/**
 * Generates standard (`llms.txt`) and comprehensive (`llms-full.txt`) previews,
 * compliance status, source coverage stats, and hosted endpoint paths for a user's site.
 */
export async function getLlmsTxtExportData(
  siteId: string,
): Promise<GetLlmsTxtExportDataResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const cleanSiteId = siteId?.trim();
    if (!cleanSiteId) {
      return { success: false, error: "Site ID is required." };
    }

    const [standard, full] = await Promise.all([
      generateLlmsTxtForSite(cleanSiteId, { full: false, userId: session.user.id }),
      generateLlmsTxtForSite(cleanSiteId, { full: true, userId: session.user.id }),
    ]);

    if (!standard || !full) {
      return { success: false, error: "Site not found or access denied." };
    }

    const cleanHost = normalizeDomainLookup(standard.site.domain) || standard.site.domain;
    const encodedDomain = encodeURIComponent(cleanHost);

    return {
      success: true,
      data: {
        siteId: standard.site.id,
        domain: standard.site.domain,
        brandName: standard.site.brandName,
        githubRepoUrl: standard.site.githubRepoUrl,
        standardContent: standard.content,
        fullContent: full.content,
        compliance: standard.compliance,
        stats: standard.stats,
        hostedPath: `/api/llms-txt?domain=${encodedDomain}`,
        hostedFullPath: `/api/llms-txt?domain=${encodedDomain}&format=full`,
      },
    };
  } catch (err) {
    logger.error("[llmsTxtAction] getLlmsTxtExportData failed", {
      siteId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: "Failed to build llms.txt preview. Please try again.",
    };
  }
}

/**
 * Creates a GitHub Pull Request adding or updating `public/llms.txt` (and optionally
 * `public/llms-full.txt`) via AST verification and `createAutoFixPR`.
 */
export async function createLlmsTxtPR(params: {
  siteId: string;
  includeFull?: boolean;
}): Promise<CreateLlmsTxtPRResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const cleanSiteId = params.siteId?.trim();
    if (!cleanSiteId) {
      return { success: false, error: "Site ID is required." };
    }

    const limited = await rateLimit("githubPr", session.user.id);
    if (limited) {
      return {
        success: false,
        error: "Rate limit exceeded for GitHub PR creation. Please try again later.",
      };
    }

    const site = await prisma.site.findFirst({
      where: { id: cleanSiteId, userId: session.user.id },
      select: { id: true, domain: true, githubRepoUrl: true },
    });

    if (!site) {
      return { success: false, error: "Site not found or access denied." };
    }

    if (!site.githubRepoUrl) {
      return {
        success: false,
        error:
          "No GitHub repository connected for this site. Add your repository URL in Site Settings first.",
      };
    }

    const account = await prisma.account.findFirst({
      where: { userId: session.user.id, provider: "github" },
      select: { access_token: true },
    });

    const token = account?.access_token;
    if (!token) {
      return {
        success: false,
        error:
          "GitHub account not connected. Connect GitHub in your account settings to create Pull Requests.",
      };
    }

    const includeFull = params.includeFull ?? true;
    const [standard, full] = await Promise.all([
      generateLlmsTxtForSite(site.id, { full: false, userId: session.user.id }),
      includeFull
        ? generateLlmsTxtForSite(site.id, { full: true, userId: session.user.id })
        : Promise.resolve(null),
    ]);

    if (!standard) {
      return { success: false, error: "Unable to generate llms.txt for this site." };
    }

    const targets = [
      { filePath: "public/llms.txt", result: standard, isFull: false },
      ...(full ? [{ filePath: "public/llms-full.txt", result: full, isFull: true }] : []),
    ];

    const filesToCommit: AutoFixFile[] = [];

    for (const target of targets) {
      const remoteFile = await getRepositoryFile(
        site.githubRepoUrl,
        target.filePath,
        token,
      );
      const existingContent =
        remoteFile.exists && typeof remoteFile.content === "string"
          ? remoteFile.content
          : "";
      const baseBlobSha =
        remoteFile.exists && remoteFile.sha ? remoteFile.sha : "NEW_FILE";

      // Skip unchanged files to avoid empty PR commits.
      if (remoteFile.exists && existingContent === target.result.content) {
        continue;
      }

      const plan: AstFixPlan = {
        version: 1,
        findingFingerprint: target.isFull ? "llms_full_txt_sync" : "llms_txt_missing",
        filePath: target.filePath,
        baseBlobSha,
        language: "llms_txt",
        operations: [{ kind: "setLlmsTxtDocument", input: target.result.input }],
        rationale: target.isFull
          ? `Create or update ${target.filePath} with comprehensive AI context and page abstracts for ${site.domain}`
          : `Create or update ${target.filePath} with site index, verified brand facts, FAQs, and top topics for ${site.domain}`,
        risk: "SAFE",
        verification: [
          {
            type: "HTTP_STATUS",
            url: target.isFull ? "/llms-full.txt" : "/llms.txt",
            expected: 200,
          },
        ],
      };

      const prepared = applyAstFixPlan(existingContent, plan);
      filesToCommit.push({
        path: target.filePath,
        content: prepared.serializedContent,
        description: target.isFull
          ? `Generate spec-compliant ${target.filePath} for AI engines`
          : `Generate spec-compliant ${target.filePath} for AI engines`,
        astPreparedChange: prepared,
      });
    }

    if (filesToCommit.length === 0) {
      return {
        success: true,
        alreadyUpToDate: true,
        files: [],
      };
    }

    const prRes = await createAutoFixPR(
      site.githubRepoUrl,
      filesToCommit,
      site.domain,
      token,
      session.user.email ?? undefined,
      undefined,
      site.id,
    );

    if (!prRes.success) {
      return {
        success: false,
        error: prRes.error ?? "Failed to create GitHub PR.",
      };
    }

    return {
      success: true,
      prUrl: prRes.prUrl,
      files: filesToCommit.map((f) => f.path),
    };
  } catch (err) {
    logger.error("[llmsTxtAction] createLlmsTxtPR failed", {
      siteId: params.siteId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error:
        err instanceof Error
          ? `Failed to create llms.txt PR: ${err.message}`
          : "Failed to create llms.txt PR.",
    };
  }
}

