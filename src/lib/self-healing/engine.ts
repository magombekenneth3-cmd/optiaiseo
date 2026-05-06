import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";

import { generateAeoFixInternal as generateAeoFix, validateFixInternal as validateFixWithQA } from "@/lib/aeo/fix-engine";
import { z } from "zod";

const ModelResultSchema = z.object({
    model: z.string(),
    score: z.number().default(0),
}).strip();

const CheckResultSchema = z.object({
    id: z.string(),
    label: z.string(),
    passed: z.boolean(),
    impact: z.enum(["high", "medium", "low"]).catch("low"),
}).strip();

const parseChecks = (data: unknown) => {
    const res = z.array(CheckResultSchema).safeParse(data);
    return res.success ? res.data : [];
};

const parseModelResults = (data: unknown) => {
    const res = z.array(ModelResultSchema).safeParse(data);
    return res.success ? res.data : [];
};

export interface HealingAction {
    type: "PR" | "CONTENT" | "SCHEMA" | "ALERT";
    description: string;
    targetId?: string; // e.g., checkId
    fix?: string;
    filePath?: string;
}

export async function detectGsovDrop(
    siteId: string
): Promise<{ dropped: boolean; currentGsov: number; prevGsov: number }> {
    const reports = await prisma.aeoReport.findMany({
        where: { siteId },
        orderBy: { createdAt: "desc" },
        take: 2,
    });

    if (reports.length < 2) return { dropped: false, currentGsov: 0, prevGsov: 0 };

    const current = reports[0].generativeShareOfVoice ?? 0;
    const prev    = reports[1].generativeShareOfVoice ?? 0;

    if (prev === 0) return { dropped: false, currentGsov: current, prevGsov: prev };

    const absoluteDrop = prev - current;
    const relativeDrop = absoluteDrop / prev;

    const isDrop =
        prev >= 20
            ? absoluteDrop >= 10
            : relativeDrop >= 0.15;

    return { dropped: isDrop, currentGsov: current, prevGsov: prev };
}

export async function generateHealingPlan(siteId: string, currentGsov: number, prevGsov: number): Promise<HealingAction[]> {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return [];

    // 1. Identify what changed in the AEO Audit
    const reports = await prisma.aeoReport.findMany({
        where: { siteId },
        orderBy: { createdAt: "desc" },
        take: 2,
    });

    const currentChecks = parseChecks(reports[0].checks);
    const prevChecks = parseChecks(reports[1].checks);
     
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentModelResults = parseModelResults((reports[0] as any).multiModelResults || []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prevModelResults = parseModelResults((reports[1] as any).multiModelResults || []);

    const actions: HealingAction[] = [];

    // 2. Model-Specific Healing: Check for drops in specific AI engines
    for (const currModel of currentModelResults) {
        const prevModel = prevModelResults.find(m => m.model === currModel.model);
        if (prevModel && currModel.score < prevModel.score - 20) {
            // Significant drop in specific model
            actions.push({
                type: "ALERT",
                description: `Citation drop in ${currModel.model} from ${prevModel.score}% to ${currModel.score}%.`,
                targetId: `model_${currModel.model}`,
                fix: `Analyze recent content for ${currModel.model} specific citation patterns.`
            });
        }
    }

    // 3. Technical Regression Healing
    for (const curr of currentChecks) {
        const prev = prevChecks.find(c => c.id === curr.id);
        if (prev?.passed && !curr.passed) {
            // This is a regression
            if (curr.impact === "high" || curr.impact === "medium") {
                const fixRes = await generateAeoFix(curr, site.domain);
                if (fixRes.success) {
                    actions.push({
                        type: (site.githubRepoUrl && process.env.GITHUB_TOKEN) ? "PR" : "CONTENT",
                        description: `Regained ${curr.label} optimization.`,
                        targetId: curr.id,
                        fix: fixRes.fix,
                        filePath: fixRes.filePath,
                    });
                }
            }
        }
    }

    // Default: If GSoV dropped but no technical check failed, it might be competitor movement
    if (actions.length === 0) {
        actions.push({
            type: "ALERT",
            description: `Significant GSoV drop from ${prevGsov}% to ${currentGsov}%. No immediate technical regressions found. Recommend reviewing competitor movements.`,
        });
    }

    return actions;
}

export async function executeHealing(siteId: string, actions: HealingAction[]) {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site || site.operatingMode !== "AUTOPILOT") return;

    for (const action of actions) {
        try {
            // QA Agent Validation Step
            if (action.fix) {
                const qaResult = await validateFixWithQA(action.fix, action.description);
                if (!qaResult.valid) {
                    logger.warn(`[Self-Healing QA Failed] ${qaResult.feedback}`);
                    action.type = "ALERT";
                    action.description += ` (QA Failed: ${qaResult.feedback}. Fix requires manual review.)`;
                }
            }

            if (action.type === "PR" && site.githubRepoUrl && action.fix && action.filePath) {
                const { pushFixToGitHub } = await import("@/app/actions/aeoFix");
                const res = await pushFixToGitHub({
                    repoUrl: site.githubRepoUrl,
                    filePath: action.filePath,
                    content: action.fix,
                    commitMessage: `Auto-Healing: ${action.description}`,
                    siteId,
                });

                await prisma.selfHealingLog.create({
                    data: {
                        siteId,
                        issueType: "GSOV_DROP",
                        description: action.description,
                        actionTaken: "DEPLOYED_GITHUB_PR",
                        impactScore: 15,
                        status: res.success ? "COMPLETED" : "FAILED",
                        metadata: (res.success
                             
                            ? { prUrl: res.url }
                            : { error: res.error }
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ) as any,
                    }
                });
            } else if (action.type === "CONTENT" || action.type === "SCHEMA") {
                await prisma.selfHealingLog.create({
                    data: {
                        siteId,
                        issueType: "GSOV_DROP",
                        description: action.description,
                         
                        actionTaken: "GENERATED_MANUAL_FIX",
                        impactScore: 10,
                        status: "PENDING",
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        metadata: { fix: action.fix, filePath: action.filePath } as any,
                    }
                });
            } else if (action.type === "ALERT") {
                await prisma.selfHealingLog.create({
                    data: {
                        siteId,
                        issueType: "GSOV_DROP",
                         
                        description: action.description,
                        actionTaken: "LOGGED_ALERT",
                        impactScore: 5,
                        status: "COMPLETED",
                         
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        metadata: { fix: action.fix } as any,
                    }
                });
            }
         
        } catch (error: unknown) {
        logger.error(`[Self-Healing] Execution failed for site ${siteId}:`, { error: (error as Error)?.message || String(error) });
        }
    }
}
