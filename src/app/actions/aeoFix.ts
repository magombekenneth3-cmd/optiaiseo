"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  generateAeoFixInternal,
  generateAllFixesInternal,
  validateFixInternal,
  type AeoCheck,
  type Framework,
} from "@/lib/aeo/fix-engine";
import { sanitizeMetadataContent } from "@/lib/seo/ai";
import { callGemini as geminiCall } from "@/lib/gemini/client";
import { getFallbackGuide, type FallbackGuide } from "@/lib/seo/fallbacks";
import { BRAND } from "@/lib/constants/brand";
import { z } from "zod";

export type { Framework, AeoCheck };

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

type ActionError = { success: false; error: string };

type GenerateAeoFixResult =
  | { success: true; fix: string; language: string; filePath: string; framework: Framework }
  | { success: false; error: string; fallbackGuide?: FallbackGuide };

type GenerateAllFixesResult =
  | {
    success: true;
    fixes: Record<string, { fix: string; language: string; filePath: string }>;
    framework: Framework;
  }
  | ActionError;

type PushFixResult =
  | { success: true; url: string }
  | ActionError;

export interface AeoRecommendationFix {
  success: true;
  headline: string;
  why: string;
  steps: string[];
  copySnippet?: string;
  competitorInsight?: string;
}

type GenerateRecommendationFixResult = AeoRecommendationFix | ActionError;

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

// Prisma uses cuid() for all PKs — validate as a non-empty string ≤ 50 chars
const uuidSchema = z.string().min(1).max(50);
const recommendationSchema = z.string().min(1).max(2000);

// ---------------------------------------------------------------------------
// Shared auth helper
// ---------------------------------------------------------------------------

async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email } });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function encodeBase64(str: string): string {
  return Buffer.from(str, "utf-8").toString("base64");
}

function decodeBase64(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return fallback;
}

function extractMetadataBlock(src: string): [number, number] | null {
  const start = src.indexOf("export const metadata");
  if (start === -1) return null;
  let depth = 0;
  let i = start;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      if (--depth === 0) return [start, i + 1];
    }
    i++;
  }
  return null;
}

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

// ---------------------------------------------------------------------------
// callGemini — thin wrapper exposed as server action
// ---------------------------------------------------------------------------

export async function callGemini(prompt: string): Promise<string | null> {
  try {
    return await geminiCall(prompt);
  } catch (err: unknown) {
    logger.error("[callGemini] failed", { error: getErrorMessage(err, "unknown") });
    return null;
  }
}

// ---------------------------------------------------------------------------
// validateFixWithQA
// ---------------------------------------------------------------------------

export async function validateFixWithQA(
  fixContent: string,
  contextDescription: string,
): Promise<{ valid: boolean; feedback: string }> {
  return validateFixInternal(fixContent, contextDescription);
}

// ---------------------------------------------------------------------------
// generateAeoFix
// ---------------------------------------------------------------------------

export async function generateAeoFix(
  check: AeoCheck,
  domain: string,
  repoUrl?: string,
): Promise<GenerateAeoFixResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: "Unauthorized" };
  return generateAeoFixInternal(check, domain, repoUrl);
}

// ---------------------------------------------------------------------------
// generateAllFixes
// ---------------------------------------------------------------------------

export async function generateAllFixes(
  checks: AeoCheck[],
  domain: string,
  repoUrl?: string,
): Promise<GenerateAllFixesResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: "Unauthorized" };
  return generateAllFixesInternal(checks, domain, repoUrl);
}

// ---------------------------------------------------------------------------
// pushFixToGitHub
// ---------------------------------------------------------------------------

export async function pushFixToGitHub(params: {
  repoUrl: string;
  filePath: string;
  content: string;
  commitMessage: string;
  siteId: string;
}): Promise<PushFixResult> {
  // --- Auth ---
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  // --- Input validation ---
  if (!uuidSchema.safeParse(params.siteId).success) {
    return { success: false, error: "Invalid site ID." };
  }
  if (!params.filePath || params.filePath.includes("..")) {
    return { success: false, error: "Invalid file path." };
  }
  if (!params.commitMessage.trim()) {
    return { success: false, error: "Commit message is required." };
  }

  // --- GitHub token ---
  const account = await prisma.account.findFirst({
    where: { userId: session.user.id, provider: "github" },
    select: { access_token: true },
  });
  const token = account?.access_token;
  if (!token) {
    return {
      success: false,
      error:
        "GitHub account not connected. Please sign in with GitHub to allow PR creation.",
    };
  }
  if (!token.startsWith("gho_") && !token.startsWith("ghp_")) {
    logger.error("[aeoFix] Unexpected GitHub token format — rejecting");
    return { success: false, error: "Invalid GitHub token format." };
  }

  // --- Parse repo URL ---
  let owner: string;
  let repo: string;
  try {
    const url = new URL(
      params.repoUrl.startsWith("http") ? params.repoUrl : `https://${params.repoUrl}`,
    );
    const parts = url.pathname
      .replace(/^\//, "")
      .replace(/\.git$/, "")
      .split("/");
    if (parts.length < 2) throw new Error("too short");
    [owner, repo] = parts;
  } catch {
    return { success: false, error: `Invalid GitHub repo URL: "${params.repoUrl}"` };
  }

  const ghHeaders: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  try {
    // --- Fetch default branch ---
    const repoRes = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: ghHeaders },
    );
    if (!repoRes.ok) return { success: false, error: "Cannot access repo." };
    const defaultBranch: string =
      (await repoRes.json()).default_branch ?? "main";

    // --- Get base SHA ---
    const refRes = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`,
      { headers: ghHeaders },
    );
    if (!refRes.ok)
      return { success: false, error: "Could not get default branch ref." };
    const baseSha: string = (await refRes.json()).object.sha;

    // --- Create fix branch ---
    const branchName = `fix/seo-autofix-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const createBranchRes = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
      },
    );
    if (!createBranchRes.ok) {
      const err = await createBranchRes.json().catch(() => ({}));
      return {
        success: false,
        error: `Failed to create branch: ${getErrorMessage(
          err,
          String(createBranchRes.status),
        )}`,
      };
    }

    // --- Prepare content (surgical metadata merge for layout.tsx) ---
    let contentToCommit = params.content;
    if (params.filePath.endsWith("layout.tsx")) {
      const trimmed = params.content.trimStart();

      if (trimmed.startsWith("import")) {
        logger.error(
          `[aeoFix] BLOCKED full-file rewrite attempt for ${params.filePath}`,
        );
        return {
          success: false,
          error:
            "The generated fix was a full file rewrite and was blocked for safety. " +
            "Only the metadata block may be changed in layout.tsx.",
        };
      }

      if (trimmed.includes("export const metadata")) {
        const existingRes = await fetchWithTimeout(
          `https://api.github.com/repos/${owner}/${repo}/contents/${params.filePath}?ref=${defaultBranch}`,
          { headers: ghHeaders },
        );
        if (!existingRes.ok) {
          return {
            success: false,
            error:
              "Could not fetch existing layout.tsx. Aborting to prevent data loss.",
          };
        }
        const existingData = await existingRes.json();
        const existingContent = decodeBase64(
          existingData.content.replace(/\n/g, ""),
        );

        const range = extractMetadataBlock(existingContent);
        if (!range) {
          return {
            success: false,
            error:
              "Could not locate metadata block in existing layout.tsx. Manual fix required.",
          };
        }
        const cleanBlock = params.content
          .replace(/^```[\w-]*\s*/gm, "")
          .replace(/^```\s*$/gm, "")
          .trim();
        const [blockStart, blockEnd] = range;
        contentToCommit =
          existingContent.slice(0, blockStart) +
          cleanBlock +
          existingContent.slice(blockEnd);
        logger.debug(
          `[aeoFix] Surgical metadata merge applied to ${params.filePath}`,
        );
      }
    }

    // --- Check for existing file SHA (needed for updates) ---
    const fileApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${params.filePath}`;
    let existingSha: string | undefined;
    const existingRes = await fetchWithTimeout(
      `${fileApiUrl}?ref=${branchName}`,
      { headers: ghHeaders },
    );
    if (existingRes.ok) {
      existingSha = (await existingRes.json()).sha;
    } else if (existingRes.status !== 404) {
      return {
        success: false,
        error: `Failed to check existing file: ${existingRes.status}`,
      };
    }

    // --- Commit file ---
    const isTypeScript =
      params.filePath.endsWith(".tsx") || params.filePath.endsWith(".ts");
    const encoded = encodeBase64(
      isTypeScript
        ? sanitizeMetadataContent(contentToCommit)
        : contentToCommit,
    );
    const commitBody: Record<string, unknown> = {
      message: `fix(seo): ${params.commitMessage}`,
      content: encoded,
      branch: branchName,
    };
    if (existingSha) commitBody.sha = existingSha;

    const putRes = await fetchWithTimeout(fileApiUrl, {
      method: "PUT",
      headers: ghHeaders,
      body: JSON.stringify(commitBody),
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      return {
        success: false,
        error: getErrorMessage(err, `GitHub API error ${putRes.status}`),
      };
    }

    // --- Open PR ---
    const prRes = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({
          title: `fix(seo): ${params.commitMessage}`,
          body: [
            `## 🤖 ${BRAND.NAME} Auto-Fix`,
            "",
            `**File:** \`${params.filePath}\``,
            `**Change:** ${params.commitMessage}`,
            "",
            "> ⚠️ Review carefully before merging.",
            "> For `layout.tsx` fixes: only the `export const metadata` block was changed.",
            "> All imports, components, and JSX are preserved exactly.",
            "",
            `_Generated by ${BRAND.NAME}._`,
          ].join("\n"),
          head: branchName,
          base: defaultBranch,
          draft: false,
        }),
      },
    );

    // PR creation failing is non-fatal — fall back to a compare URL
    if (!prRes.ok) {
      return {
        success: true,
        url: `https://github.com/${owner}/${repo}/compare/${branchName}`,
      };
    }

    return { success: true, url: (await prRes.json()).html_url };
  } catch (err: unknown) {
    logger.error("[aeoFix] pushFixToGitHub error", {
      error: getErrorMessage(err, String(err)),
      siteId: params.siteId,
    });
    return {
      success: false,
      error: "An unexpected error occurred while pushing to GitHub.",
    };
  }
}

// ---------------------------------------------------------------------------
// generateAeoRecommendationFix
// ---------------------------------------------------------------------------

const AeoRecommendationSchema = z.object({
  headline: z.string(),
  why: z.string(),
  steps: z.array(z.string()),
  copySnippet: z.string().optional(),
  competitorInsight: z.string().optional(),
});

const GEO_RESEARCH_CONTEXT = `
## GEO Research Context (Ahrefs study of 75,000 brands & 25M AI overviews)
Use these as the evidence basis for your recommendations:
1. **Branded Mentions > Backlinks**: Third-party branded mentions on credible sites have the STRONGEST correlation with Google AI Overview visibility — higher than backlinks, referring domains, or domain rating. Every mention on a high-traffic page is a training example for LLMs.
2. **Longtail Sub-queries**: AI assistants fan a single prompt into dozens of longtail sub-queries, then synthesize answers. Brands ranking for those niche sub-queries get included in the final AI response. Content clusters (pillar + 6-10 supporting posts) dramatically increase AI inclusion likelihood.
3. **Content Freshness = Retrieval Signal**: AI-cited content is 25.7% fresher than regular Google results. ChatGPT and Perplexity list citations newest-to-oldest. RAG (Retrieval-Augmented Generation) fetches fresh content when topics are evolving — freshness is now a retrieval signal, not just a ranking signal.
4. **AI Bot Access**: 5.9% of 140M websites accidentally block OpenAI's GPTBot in robots.txt. You cannot rank in AI you won't let crawl you.
5. **Platform Diversification**: Only 7 of the top 50 cited domains appear on Google AI, ChatGPT, AND Perplexity. Each platform prefers different sources: Google AI → YouTube, Reddit, Quora; ChatGPT → Reuters, AP-style publishers; Perplexity → niche/regional blogs. Dominating one ecosystem doesn't guarantee presence on others.
`.trim();

export async function generateAeoRecommendationFix(
  siteId: string,
  recommendation: string,
  competitors: string[],
  failedCategory?: string,
): Promise<GenerateRecommendationFixResult> {
  // --- Input validation ---
  if (!uuidSchema.safeParse(siteId).success) {
    return { success: false, error: "Invalid site ID." };
  }
  if (!recommendationSchema.safeParse(recommendation).success) {
    return { success: false, error: "Recommendation must be 1–2000 characters." };
  }

  // --- Auth ---
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: "Unauthorized" };

  const site = await prisma.site.findFirst({ where: { id: siteId, userId: user.id } });
  if (!site) return { success: false, error: "Site not found" };

  // --- Build site context ---
  const siteKeywords = site.targetKeyword ? [site.targetKeyword] : [];
  const coreServices = (site as Record<string, unknown>).coreServices as
    | string
    | null;
  const siteContext = [
    `Domain: ${site.domain}`,
    siteKeywords.length ? `Keywords: ${siteKeywords.slice(0, 8).join(", ")}` : "",
    coreServices ? `Services: ${coreServices}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const topCompetitors =
    competitors.slice(0, 3).join(", ") || "unnamed competitors";
  const categoryLabel = (failedCategory ?? "AEO visibility").replace(/_/g, " ");

  const prompt = `You are an expert in Generative Engine Optimisation (GEO), Answer Engine Optimisation (AEO), and AI Search Visibility. You have deep knowledge of the latest research on what makes brands get cited in AI-generated answers.

${GEO_RESEARCH_CONTEXT}

## Site context
${siteContext}

## AEO/GEO problem
Category: ${categoryLabel}
Scan finding: "${recommendation}"

## Competitors currently beating this site in AI answers (ChatGPT, Perplexity, Gemini, Claude)
${topCompetitors}

## Your task
Produce a targeted, implementation-ready fix that helps ${site.domain} outrank ${topCompetitors} in AI-generated answers for the "${categoryLabel}" category. Ground your advice in the Ahrefs research above where relevant.

Rules:
- Analyse what ${topCompetitors} likely does to earn AI citations in this category
- Propose concrete strategy for ${site.domain} — not generic SEO advice
- Reference specific stats from the research context when applicable (e.g. "25.7% fresher", "#1 correlation signal")
- Where applicable, include a ready-to-paste snippet (JSON-LD schema, FAQ block, About page copy, robots.txt entry, etc.)

Return ONLY valid JSON:
{
  "headline": "One sentence describing the fix (≤15 words)",
  "why": "Why this beats ${topCompetitors} specifically, referencing the GEO research where relevant (2-3 sentences)",
  "steps": ["Step 1", "Step 2", "Step 3", "Step 4 (optional)"],
  "copySnippet": "Ready-to-paste content — schema markup, FAQ copy, robots.txt snippet, or paragraph. Omit key if not applicable.",
  "competitorInsight": "What ${topCompetitors} likely does to get cited here (1-2 sentences)"
}
Return ONLY JSON, no markdown fences or explanation.`;

  // --- Call Gemini ---
  let raw: string;
  try {
    raw = await geminiCall(prompt);
  } catch (e: unknown) {
    logger.error("[aeoFix] Gemini call failed", {
      error: getErrorMessage(e, "unknown"),
      siteId,
    });
    return { success: false, error: getErrorMessage(e, "AI unavailable.") };
  }

  // --- Parse + validate response ---
  try {
    const clean = raw.replace(/^```json\s*|^```\s*|```\s*$/gm, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found in AI response");

    const parsed = AeoRecommendationSchema.parse(JSON.parse(jsonMatch[0]));
    return { success: true, ...parsed };
  } catch (e: unknown) {
    logger.error("[aeoFix] AI response parse/validation failed", {
      error: getErrorMessage(e, "unknown"),
      siteId,
    });
    return {
      success: false,
      error: "Failed to parse AI response. Please try again.",
    };
  }
}