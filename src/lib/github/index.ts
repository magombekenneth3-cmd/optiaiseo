import { logger } from "@/lib/logger";
import { Octokit } from "@octokit/rest";
import { BRAND } from "@/lib/constants/brand";
import {
    registerEffect,
    assertEffectChannelEnabled,
    MutationBlockedError,
} from "@/lib/mutations";

const MAX_FILE_SIZE = 1_000_000;

const BLOCKED_PATH_PREFIXES = [
    ".github/workflows",
    ".git/",
    ".env",
];

export interface AutoFixFile {
    path: string;
    content: string;
    description: string;
}

export interface GitHubPRResult {
    success: boolean;
    prUrl?: string;
    branchName?: string;
    error?: string;
    effectId?: string;
}

/**
 * Opens a single PR containing all provided fix files.
 *
 * When operationId + siteId are provided, this function:
 *   1. Checks the GITHUB channel kill switch
 *   2. Registers a GITHUB_PR MutationEffect
 *   3. Updates the effect status on success/failure
 *
 * @param repoUrl      - Full GitHub URL, e.g. https://github.com/owner/repo
 * @param files        - Array of files to commit
 * @param domain       - Site domain (used in PR title / body)
 * @param token        - GitHub token
 * @param userEmail    - Optional email to send notification
 * @param operationId  - Optional: links this PR to a MutationOperation
 * @param siteId       - Optional: required for kill switch check
 */
export async function createAutoFixPR(
    repoUrl: string,
    files: AutoFixFile[],
    domain: string,
    token: string,
    userEmail?: string,
    operationId?: string,
    siteId?: string,
): Promise<GitHubPRResult> {
    if (!token) {
        return { success: false, error: "GitHub account not connected." };
    }

    if (!files.length) {
        return { success: false, error: "No fix files provided." };
    }

    // ── Kill switch check ────────────────────────────────────────────────
    if (siteId) {
        try {
            await assertEffectChannelEnabled(siteId, "GITHUB");
        } catch (err) {
            if (err instanceof MutationBlockedError) {
                logger.warn("[GitHub Engine] GITHUB channel blocked by kill switch", {
                    siteId,
                    repoUrl,
                });
                return { success: false, error: `GitHub channel blocked: ${err.message}` };
            }
            throw err;
        }
    }

    const encoder = new TextEncoder();
    if (files.some((f) => encoder.encode(f.content).length > MAX_FILE_SIZE)) {
        return { success: false, error: "One or more files exceed the 1MB size limit." };
    }

    for (const file of files) {
        const p = file.path;
        if (
            !p ||
            p.trim() === "" ||
            p.startsWith("/") ||
            p.includes("..") ||
            p.includes("\\") ||
            p.includes("\0")
        ) {
            return { success: false, error: `Invalid file path: ${p}` };
        }
        if (BLOCKED_PATH_PREFIXES.some((prefix) => p.startsWith(prefix))) {
            return { success: false, error: `Refusing to write to protected path: ${p}` };
        }
    }

    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.?#]+)(?:\.git)?/);
    if (!match) {
        return { success: false, error: `Cannot parse GitHub URL: ${repoUrl}` };
    }
    const [, owner, repo] = match;

    logger.info("[GitHub Engine] PR flow started", { owner, repo, fileCount: files.length, operationId });

    // ── Register MutationEffect if we have an operation ──────────────────
    let effectId: string | undefined;
    if (operationId) {
        try {
            effectId = await registerEffect({
                operationId,
                effectType: "GITHUB_PR",
                payload: {
                    repoUrl,
                    owner,
                    repo,
                    fileCount: files.length,
                    domain,
                },
                confirmationMode: "POLL",
                compensationPolicy: "ROLLBACK_PARTIAL",
                idempotencyParams: {
                    owner,
                    repo,
                    date: new Date().toISOString().slice(0, 10),
                },
            });
        } catch (effectErr) {
            logger.warn("[GitHub Engine] Effect registration failed — continuing with direct dispatch", {
                operationId,
                error: (effectErr as Error)?.message,
            });
        }
    }

    try {
        const octokit = new Octokit({ auth: token });

        const { data: repoData } = await octokit.repos.get({ owner, repo });
        const defaultBranch = repoData.default_branch;

        const { data: refData } = await octokit.git.getRef({
            owner,
            repo,
            ref: `heads/${defaultBranch}`,
        });
        const defaultBranchSha = refData.object.sha;

        const today = new Date().toISOString().slice(0, 10);
        const branchName = `ai-seo-fixes-${owner}-${repo}-${today}`;

        const existingPRs = await octokit.pulls.list({
            owner,
            repo,
            head: `${owner}:${branchName}`,
            state: "open",
        });

        if (existingPRs.data.length > 0) {
            const pr = existingPRs.data[0];
            logger.info("[GitHub Engine] PR already exists — returning early", { prUrl: pr.html_url });
            // Update effect as DISPATCHED — the PR already exists
            if (effectId) {
                await updateEffectStatus(effectId, "DISPATCHED", pr.html_url);
            }
            return { success: true, prUrl: pr.html_url, branchName, effectId };
        }

        try {
            await octokit.git.createRef({
                owner,
                repo,
                ref: `refs/heads/${branchName}`,
                sha: defaultBranchSha,
            });
        } catch (err: unknown) {
            if (!(err as Error)?.message?.includes("already exists")) throw err;
            logger.debug("[GitHub Engine] Branch exists — resetting to default branch HEAD", { branchName });
            await octokit.git.updateRef({
                owner,
                repo,
                ref: `heads/${branchName}`,
                sha: defaultBranchSha,
                force: true,
            });
        }

        const { data: branchRef } = await octokit.git.getRef({
            owner,
            repo,
            ref: `heads/${branchName}`,
        });
        const parentSha = branchRef.object.sha;

        const blobs = await Promise.all(
            files.map(async (file) => {
                const res = await octokit.git.createBlob({
                    owner,
                    repo,
                    content: Buffer.from(file.content, "utf-8").toString("base64"),
                    encoding: "base64",
                });
                if (!res?.data?.sha) {
                    throw new Error(`Blob creation failed for ${file.path}`);
                }
                return res;
            })
        );

        const { data: baseCommit } = await octokit.git.getCommit({
            owner,
            repo,
            commit_sha: parentSha,
        });

        const { data: tree } = await octokit.git.createTree({
            owner,
            repo,
            base_tree: baseCommit.tree.sha,
            tree: files.map((file, i) => ({
                path: file.path,
                mode: "100644",
                type: "blob",
                sha: blobs[i].data.sha,
            })),
        });

        if (!tree?.sha) {
            throw new Error("Tree creation failed — aborting commit.");
        }

        const { data: commit } = await octokit.git.createCommit({
            owner,
            repo,
            message: `fix(seo): apply ${files.length} automated SEO fix${files.length > 1 ? "es" : ""} for ${domain}`,
            tree: tree.sha,
            parents: [parentSha],
        });

        await octokit.git.updateRef({
            owner,
            repo,
            ref: `heads/${branchName}`,
            sha: commit.sha,
        });

        const tableRows = files
            .map((f) => `| \`${f.path}\` | ${f.description} |`)
            .join("\n");

        const prBody = `## 🤖 ${BRAND.NAME} Auto-Fix Report

Automated by **${BRAND.NAME}** for \`${domain}\`.

### Files Updated

| File | Fix Applied |
|------|-------------|
${tableRows}

---

> Review each file, then click **Merge pull request** to apply the SEO improvements.
> These fixes were generated based on your latest AEO audit results.`;

        const { data: prData } = await octokit.pulls.create({
            owner,
            repo,
            title: `🤖 ${BRAND.NAME} Auto-Fix: ${files.length} issue${files.length > 1 ? "s" : ""} found for ${domain}`,
            head: branchName,
            base: defaultBranch,
            body: prBody,
        });

        logger.info("[GitHub Engine] PR opened successfully", { prUrl: prData.html_url });

        // Update effect status on success
        if (effectId) {
            await updateEffectStatus(effectId, "DISPATCHED", prData.html_url);
        }

        if (userEmail) {
            try {
                const { sendPrNotification } = await import("@/lib/email/pr-notification");
                await sendPrNotification(userEmail, {
                    domain,
                    repoName: repo,
                    prUrl: prData.html_url,
                    fixCount: files.length,
                });
            } catch (emailErr) {
                logger.error("[GitHub Engine] Failed to send PR notification email", {
                    error: (emailErr as Error)?.message || String(emailErr),
                });
            }
        }

        return { success: true, prUrl: prData.html_url, branchName, effectId };

    } catch (error: unknown) {
        logger.error("[GitHub Engine] PR flow failed", {
            owner,
            repo,
            error: (error as Error)?.message || String(error),
        });

        // Update effect status on failure
        if (effectId) {
            await updateEffectStatus(effectId, "FAILED", undefined, (error as Error)?.message);
        }

        return {
            success: false,
            error: (error as Error).message || "Unknown GitHub API error.",
            effectId,
        };
    }
}

/**
 * Updates a MutationEffect's status after dispatch attempt.
 */
async function updateEffectStatus(
    effectId: string,
    status: "DISPATCHED" | "FAILED",
    externalId?: string,
    externalError?: string,
): Promise<void> {
    try {
        const { prisma } = await import("@/lib/prisma");
        await (prisma as any).mutationEffect.update({
            where: { id: effectId },
            data: {
                status,
                dispatchedAt: status === "DISPATCHED" ? new Date() : undefined,
                failedAt: status === "FAILED" ? new Date() : undefined,
                externalId: externalId || undefined,
                externalError: externalError || undefined,
                attempts: { increment: 1 },
            },
        });
    } catch (updateErr) {
        logger.warn("[GitHub Engine] Failed to update effect status", {
            effectId,
            status,
            error: (updateErr as Error)?.message,
        });
    }
}