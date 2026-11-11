import { logger } from "@/lib/logger";
import { getFullAuditEngine } from '../seo-audit';

export function extractAuditVitalsAndSchema(report: {
    categories?: Array<{
        id: string;
        score?: number;
        items?: Array<{ id: string; value?: number; details?: Record<string, unknown> }>;
    }>;
}): {
    lcp: number | null;
    cls: number | null;
    inp: number | null;
    schemaScore: number | null;
    aeoScore: number | null;
} {
    const categories = report.categories ?? [];
    const allItems = categories.flatMap((c) => c.items ?? []);

    const findNum = (itemIds: string[], detailKeys: string[]): number | null => {
        for (const id of itemIds) {
            const item = allItems.find((i) => i.id === id);
            if (!item) continue;
            for (const key of detailKeys) {
                const v = item.details?.[key];
                if (typeof v === "number" && Number.isFinite(v)) return v;
            }
            if (typeof item.value === "number" && Number.isFinite(item.value)) return item.value;
        }
        return null;
    };

    const rawLcp = findNum(
        ["cwv-mobile-lcp", "core-web-vitals-lcp", "cwv-desktop-lcp", "lcp"],
        ["cruxMobileLcpP75Ms", "labLcpMs", "cruxLcpMs", "desktopLabLcpMs", "cruxDesktopLcpP75Ms"]
    );
    const lcp = rawLcp != null
        ? Math.round(((rawLcp > 30 ? rawLcp / 1000 : rawLcp)) * 100) / 100
        : null;

    const rawCls = findNum(
        ["cwv-mobile-cls", "core-web-vitals-cls", "cwv-desktop-cls", "cls"],
        ["cruxMobileClsP75", "labCls", "cruxCls", "desktopLabCls", "cruxDesktopClsP75"]
    );
    const cls = rawCls != null ? Math.round(rawCls * 1000) / 1000 : null;

    const rawInp = findNum(
        ["cwv-mobile-inp", "core-web-vitals-inp", "cwv-desktop-inp", "inp"],
        ["cruxMobileInpP75Ms", "labInpMs", "cruxInpMs", "desktopLabInpMs", "cruxDesktopInpP75Ms"]
    );
    const inp = rawInp != null ? Math.round(rawInp) : null;

    const schemaCat = categories.find((c) => c.id === "schema-markup" || c.id === "schema");
    const aiCat = categories.find((c) => c.id === "ai-visibility");

    return {
        lcp,
        cls,
        inp,
        schemaScore: typeof schemaCat?.score === "number" ? schemaCat.score : null,
        aeoScore: typeof aiCat?.score === "number" ? aiCat.score : null,
    };
}

export async function runSiteAudit(domain: string, opts?: { targetKeyword?: string }) {
    logger.debug(`[Audit Engine] Starting comprehensive SEO scan for ${domain}...`);

    let urlStr = domain.trim();
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
        urlStr = `https://${urlStr}`;
    }

    const engine = getFullAuditEngine();
    const report = await engine.runAudit(urlStr, { targetKeyword: opts?.targetKeyword });

    const categoryScores: Record<string, number> = {};
    report.categories.forEach(cat => {
        categoryScores[cat.id] = cat.score;
    });

    const vitals = extractAuditVitalsAndSchema(report);

    logger.debug(`[Audit Engine] Scan complete for ${domain}. Overall Score: ${report.overallScore}. Categories: ${report.categories.length}`);

    return {
        score: report.overallScore,
        categoryScores,
        rawReport: report,
        lcp: vitals.lcp,
        cls: vitals.cls,
        inp: vitals.inp,
        issues: report.recommendations.map(rec => ({
            category: rec.categoryId,
            severity: rec.priority === 'High' ? 'error' : 'warning',
            title: rec.label || rec.itemId,
            description: rec.finding,
            impact: rec.priority,
            fixSuggestion: rec.recommendation
        }))
    };
}
