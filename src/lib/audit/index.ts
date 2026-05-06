import { logger } from "@/lib/logger";
import { getFullAuditEngine } from '../seo-audit';

export async function runSiteAudit(domain: string, opts?: { targetKeyword?: string }) {
    logger.debug(`[Audit Engine] Starting comprehensive SEO scan for ${domain}...`);

    let urlStr = domain.trim();
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
        urlStr = `https://${urlStr}`;
    }

    // Let errors PROPAGATE — do NOT catch here silently.
    // The caller (generateMockAudit) is responsible for surfacing real messages to the UI.
    const engine = getFullAuditEngine();
    const report = await engine.runAudit(urlStr, { targetKeyword: opts?.targetKeyword });

    // Convert new category Results to a score map
    const categoryScores: Record<string, number> = {};
    report.categories.forEach(cat => {
        categoryScores[cat.id] = cat.score;
    });

    // Ensure 'seo' key explicitly exists for legacy UI components
    categoryScores['seo'] = report.overallScore;

    logger.debug(`[Audit Engine] Scan complete for ${domain}. Overall Score: ${report.overallScore}. Categories: ${report.categories.length}`);

    return {
        score: report.overallScore,
        categoryScores,
        rawReport: report,
        lcp: null,
        cls: null,
        inp: null,
        // Map recommendations to legacy format just in case
        issues: report.recommendations.map(rec => ({
            category: rec.categoryId,
            severity: rec.priority === 'High' ? 'error' : 'warning',
            title: rec.itemId,
            description: rec.finding,
            impact: rec.priority,
            fixSuggestion: rec.recommendation
        }))
    };
}
