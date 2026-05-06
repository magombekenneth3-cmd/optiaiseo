import prisma from "@/lib/prisma";
import { parseAuditResult } from "@/lib/seo-audit/parse-audit-result";

export interface DiffItem {
    id: string;
    title: string;
    category: string;
    previousSeverity?: string;
    currentSeverity?: string;
}

export interface AuditDiffData {
    fixed: DiffItem[];
    newIssues: DiffItem[];
    degraded: DiffItem[];
    scoreDelta: number;
    previousScore: number;
    currentScore: number;
    previousDate: string;
}

interface FlatItem {
    id: string;
    label: string;
    status: string;
    category: string;
}

function buildItemMap(parsed: ReturnType<typeof parseAuditResult>): Map<string, FlatItem> {
    const map = new Map<string, FlatItem>();
    for (const cat of parsed.categories) {
        for (const item of cat.items) {
            map.set(item.id, {
                id: item.id,
                label: item.label,
                status: item.status,
                category: cat.id,
            });
        }
    }
    return map;
}

export async function computeAuditDiff(
    auditId: string,
    siteId: string,
): Promise<AuditDiffData | null> {
    const [currentAudit, previousAudit] = await Promise.all([
        prisma.audit.findFirst({
            where: { id: auditId, siteId },
            select: { id: true, issueList: true, runTimestamp: true, categoryScores: true },
        }),
        prisma.audit.findFirst({
            where: {
                siteId,
                id: { not: auditId },
            },
            orderBy: { runTimestamp: "desc" },
            select: { id: true, issueList: true, runTimestamp: true, categoryScores: true },
        }),
    ]);

    if (!currentAudit || !previousAudit) return null;

    const currentParsed  = parseAuditResult(currentAudit.issueList);
    const previousParsed = parseAuditResult(previousAudit.issueList);

    const currentItems  = buildItemMap(currentParsed);
    const previousItems = buildItemMap(previousParsed);

    const fixed:     DiffItem[] = [];
    const newIssues: DiffItem[] = [];
    const degraded:  DiffItem[] = [];

    for (const [id, prevItem] of previousItems) {
        if (prevItem.status === "Pass" || prevItem.status === "Info") continue;
        const curr = currentItems.get(id);
        if (!curr || curr.status === "Pass") {
            fixed.push({ id: prevItem.id, title: prevItem.label, category: prevItem.category });
        }
    }

    for (const [id, currItem] of currentItems) {
        if (currItem.status === "Pass" || currItem.status === "Info") continue;
        const prev = previousItems.get(id);
        if (!prev || prev.status === "Pass") {
            newIssues.push({ id: currItem.id, title: currItem.label, category: currItem.category });
        }
    }

    for (const [id, currItem] of currentItems) {
        if (currItem.status !== "Fail") continue;
        const prev = previousItems.get(id);
        if (prev && prev.status === "Warning") {
            degraded.push({
                id: currItem.id,
                title: currItem.label,
                category: currItem.category,
                previousSeverity: "Warning",
                currentSeverity: "Fail",
            });
        }
    }

    return {
        fixed,
        newIssues,
        degraded,
        scoreDelta:    currentParsed.overallScore - previousParsed.overallScore,
        currentScore:  currentParsed.overallScore,
        previousScore: previousParsed.overallScore,
        previousDate:  previousAudit.runTimestamp.toISOString(),
    };
}
