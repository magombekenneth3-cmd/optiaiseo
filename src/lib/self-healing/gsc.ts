import { logger } from "@/lib/logger";
import { fetchGSCKeywordsByDateRange, normaliseSiteUrl } from "@/lib/gsc";
import { getUserGscToken } from "@/lib/gsc/token";
import { prisma } from "@/lib/prisma";
import { HealingAction } from "./engine";
import { callGemini } from "@/lib/gemini/client";

 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function detectGscAnomalies(siteId: string): Promise<{ dropped: boolean; anomalies: any[] }> {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return { dropped: false, anomalies: [] };

    let token: string;
    try {
        token = await getUserGscToken(site.userId);
    } catch {
        // User hasn't connected GSC — skip silently, self-healing is best-effort
        return { dropped: false, anomalies: [] };
    }

    const siteUrl = normaliseSiteUrl(site.domain);

    try {
        const today = new Date();

        // FIX #2: GSC has a 2-3 day reporting lag. Using today as recentEnd means
        // the tail of the window always shows 0 impressions, triggering false
        // anomaly alerts every single day. Offset both windows by GSC_LAG_DAYS.
        const GSC_LAG_DAYS = 3;

        // Recent window: 7 days ending 3 days ago (avoids incomplete data)
        const recentEnd = new Date(today);
        recentEnd.setDate(today.getDate() - GSC_LAG_DAYS);           // e.g. 3 days ago
        const recentStart = new Date(today);
        recentStart.setDate(today.getDate() - (7 + GSC_LAG_DAYS));   // e.g. 10 days ago

        // Previous window: the 7 days before the recent window (non-overlapping)
        const prevEnd = new Date(today);
        prevEnd.setDate(today.getDate() - (GSC_LAG_DAYS + 8));       // e.g. 11 days ago
        const prevStart = new Date(today);
        prevStart.setDate(today.getDate() - (GSC_LAG_DAYS + 15));    // e.g. 18 days ago

        const [recentData, previousData] = await Promise.all([
            fetchGSCKeywordsByDateRange(token, siteUrl, recentStart, recentEnd),
            fetchGSCKeywordsByDateRange(token, siteUrl, prevStart, prevEnd),
        ]);

        const anomalies = [];

        for (const recent of recentData) {
            const prev = previousData.find(
                p => p.url === recent.url && p.keyword === recent.keyword
            );

            if (prev && prev.impressions > 50 && recent.impressions < prev.impressions * 0.85) {
                anomalies.push({
                    url: recent.url,
                    keyword: recent.keyword,
                    metric: "impressions",
                    before: prev.impressions,
                    after: recent.impressions,
                    dropPercentage: Math.round(
                        ((prev.impressions - recent.impressions) / prev.impressions) * 100
                    ),
                });
            }
        }

         
        return { dropped: anomalies.length > 0, anomalies };
     
    } catch (e: unknown) {
        logger.error(`[GSC Anomaly] Failed for site ${siteId}`, { error: (e as Error)?.message || String(e) });
        return { dropped: false, anomalies: [] };
    }
 
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateGscHealingPlan(siteId: string, anomalies: any[]): Promise<HealingAction[]> {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return [];

    const actions: HealingAction[] = [];

    for (const anomaly of anomalies) {
        // Context-Aware PR Generation: AI rewrites Title/H1 based on intent shift
        const prompt = `
        The page ${anomaly.url} has experienced a ${anomaly.dropPercentage}% drop in search impressions for the keyword "${anomaly.keyword}".
        This suggests an intent shift in Google's SERP.

        Please generate a strategic fix to regain this traffic.
        1. Rewrite the <title> tag to better match search intent for "${anomaly.keyword}".
        2. Rewrite the main <h1> tag.
        3. Suggest a brief introductory hook update.

        Return ONLY a raw JSON object:
        {
            "filePath": "app/page.tsx", // Or best guess based on URL
            "fixContent": "The new React/Next.js code snippet showing the updated title and H1."
        }
        `;

        let geminiRes = null;
        try {
            geminiRes = await callGemini(prompt, { maxOutputTokens: 8192, temperature: 0.2 });
        } catch {}
        let fixContent = "Update Title/H1 tags to better match the intent of: " + anomaly.keyword;
        // FIX #10: Previously used .split("/").pop() which only extracted the last
        // URL segment, producing the wrong path for any URL deeper than one level.
        // e.g. /blog/my-post was guessed as app/my-post/page.tsx (missing blog/).
        function urlToAppRouterPath(url: string, domain: string): string {
            try {
                const { pathname } = new URL(url);
                if (pathname === "/" || pathname === "") return "app/page.tsx";
                const segments = pathname.split("/").filter(Boolean);
                return `app/${segments.join("/")}/page.tsx`;
            } catch {
                logger.warn(`[GSC Anomaly] Malformed URL for path guess: ${url} (domain: ${domain})`);
                return "app/page.tsx";
            }
        }
        let filePath = urlToAppRouterPath(anomaly.url, site.domain);

        if (geminiRes) {
            try {
                const cleanJson = geminiRes.replace(/```json/g, '').replace(/```/g, '').trim();
                 
                const parsed = JSON.parse(cleanJson);
                if (parsed.filePath) filePath = parsed.filePath;
                if (parsed.fixContent) fixContent = parsed.fixContent;
             
            } catch (e: unknown) {
                logger.error("[GSC Anomaly] Failed to parse Gemini response for PR fix.", { error: (e as Error)?.message || String(e) });
            }
        }

        actions.push({
            type: (site.githubRepoUrl && process.env.GITHUB_TOKEN) ? "PR" : "CONTENT",
            description: `GSC Drop Detected: ${anomaly.dropPercentage}% drop for '${anomaly.keyword}' on ${anomaly.url}. Automatically adjusting intent targeting.`,
            targetId: anomaly.keyword,
            fix: fixContent,
            filePath: filePath,
        });
    }

    return actions;
}
