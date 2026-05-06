// =============================================================================
// FIX #31: Traffic Impact Estimation
// Attaches "estimated traffic impact" to each audit finding based on:
//   - Current estimated monthly visits (from competitor module rank data)
//   - Improvement in CTR if the finding is fixed
//   - The finding's roiImpact score (0-100)
// =============================================================================

import type { ChecklistItem } from '../seo-audit/types';

export interface TrafficImpact {
    estimatedTrafficGainPerMonth: number;
    confidenceLabel: 'Low' | 'Medium' | 'High';
    rationale: string;
}

// CTR improvement table (conservative estimates based on Sistrix research)
// Fixing a specific issue TYPE typically yields this fractional CTR gain
const ROI_TO_CTR_GAIN: Array<{ minRoi: number; ctrGain: number }> = [
    { minRoi: 90, ctrGain: 0.08 },   // Critical fixes: up to 8% CTR gain
    { minRoi: 75, ctrGain: 0.05 },
    { minRoi: 60, ctrGain: 0.03 },
    { minRoi: 40, ctrGain: 0.015 },
    { minRoi: 0,  ctrGain: 0.005 },
];

function getCtrGain(roiImpact: number): number {
    for (const entry of ROI_TO_CTR_GAIN) {
        if (roiImpact >= entry.minRoi) return entry.ctrGain;
    }
    return 0.005;
}

/**
 * Annotates audit checklist items with estimated monthly traffic gain.
 * @param items           Audit checklist items (only failed/warning items get estimates)
 * @param currentMonthlyVisits  Current estimated monthly organic visits to the page
 */
export function annotateTrafficImpact(
    items: ChecklistItem[],
    currentMonthlyVisits: number
): Array<ChecklistItem & { trafficImpact?: TrafficImpact }> {
    return items.map(item => {
        // Only estimate impact for failed/warning items with a recommendation
        if (item.status === 'Pass' || item.status === 'Info' || item.status === 'Skipped') {
            return item;
        }

        const roiImpact = item.roiImpact ?? 50;
        const ctrGain = getCtrGain(roiImpact);
        const estimatedTrafficGainPerMonth = Math.round(currentMonthlyVisits * ctrGain);

        const confidenceLabel: 'Low' | 'Medium' | 'High' =
            roiImpact >= 80 ? 'High' : roiImpact >= 50 ? 'Medium' : 'Low';

        const rationale = `Fixing this issue is estimated to improve organic CTR by ~${(ctrGain * 100).toFixed(1)}%, ` +
            `adding ~${estimatedTrafficGainPerMonth.toLocaleString()} visits/month based on current traffic of ` +
            `${currentMonthlyVisits.toLocaleString()} visits/month.`;

        return {
            ...item,
            trafficImpact: {
                estimatedTrafficGainPerMonth,
                confidenceLabel,
                rationale,
            },
        };
    });
}


// =============================================================================
// FIX #30: Audit Diff Utility
// Compares two audit snapshots and returns added/fixed/degraded findings.
// =============================================================================

export interface AuditDiffItem {
    id: string;
    label: string;
    change: 'fixed' | 'new_issue' | 'degraded' | 'improved';
    previousStatus: string;
    currentStatus: string;
}

export interface AuditDiff {
    fixed: AuditDiffItem[];
    newIssues: AuditDiffItem[];
    improved: AuditDiffItem[];
    degraded: AuditDiffItem[];
    scoreChange: number; // positive = improved
    summary: string;
}

type StatusRank = Record<string, number>;
const STATUS_RANK: StatusRank = { Pass: 3, Warning: 2, Fail: 1, Info: 0, Skipped: 0 };

export function diffAuditSnapshots(
    previous: ChecklistItem[],
    current: ChecklistItem[]
): AuditDiff {
    const prevMap = new Map(previous.map(item => [item.id, item]));
    const currMap = new Map(current.map(item => [item.id, item]));

    const fixed: AuditDiffItem[] = [];
    const newIssues: AuditDiffItem[] = [];
    const improved: AuditDiffItem[] = [];
    const degraded: AuditDiffItem[] = [];

    currMap.forEach((currItem, id) => {
        const prevItem = prevMap.get(id);
        if (!prevItem) {
            // Brand new check — only flag if it's a failure
            if (currItem.status === 'Fail' || currItem.status === 'Warning') {
                newIssues.push({
                    id,
                    label: currItem.label,
                    change: 'new_issue',
                    previousStatus: 'N/A',
                    currentStatus: currItem.status,
                });
            }
            return;
        }

        const prevRank = STATUS_RANK[prevItem.status] ?? 0;
        const currRank = STATUS_RANK[currItem.status] ?? 0;

        if (currRank > prevRank) {
            // Status improved
            if (currItem.status === 'Pass') {
                fixed.push({ id, label: currItem.label, change: 'fixed', previousStatus: prevItem.status, currentStatus: currItem.status });
            } else {
                improved.push({ id, label: currItem.label, change: 'improved', previousStatus: prevItem.status, currentStatus: currItem.status });
            }
        } else if (currRank < prevRank) {
            degraded.push({ id, label: currItem.label, change: 'degraded', previousStatus: prevItem.status, currentStatus: currItem.status });
        }
    });

    const prevScore = previous.filter(i => i.status === 'Pass').length;
    const currScore = current.filter(i => i.status === 'Pass').length;
    const scoreChange = currScore - prevScore;

    const parts: string[] = [];
    if (fixed.length > 0) parts.push(`✅ ${fixed.length} fixed`);
    if (newIssues.length > 0) parts.push(`🆕 ${newIssues.length} new`);
    if (improved.length > 0) parts.push(`📈 ${improved.length} improved`);
    if (degraded.length > 0) parts.push(`⚠️ ${degraded.length} degraded`);
    if (parts.length === 0) parts.push('No changes detected');

    return {
        fixed,
        newIssues,
        improved,
        degraded,
        scoreChange,
        summary: parts.join(' | '),
    };
}
