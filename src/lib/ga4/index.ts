import { logger } from "@/lib/logger";

export interface Ga4Metrics {
    sessions: number;
    users: number;
    bounceRate: number;
    avgSessionDuration: number;
    pageviews: number;
    conversions: number;
    topPages: { path: string; views: number; avgTime: number }[];
    topChannels: { channel: string; sessions: number; pct: number }[];
    organicSessions: number;
    organicPct: number;
}

export async function fetchGa4Metrics(
    accessToken: string,
    propertyId: string,
    days = 28
): Promise<Ga4Metrics | null> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const body = {
        dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
        metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "bounceRate" },
            { name: "averageSessionDuration" },
            { name: "screenPageViews" },
            { name: "conversions" },
        ],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        limit: 20,
    };

    try {
        const res = await fetch(
            `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15_000),
            }
        );

        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            logger.warn("[GA4] API error", { status: res.status, body: errText.slice(0, 200) });
            return null;
        }

        const data = await res.json();
        const rows = data.rows ?? [];

        let totalSessions = 0;
        let totalUsers = 0;
        let totalBounce = 0;
        let totalDuration = 0;
        let totalPageviews = 0;
        let totalConversions = 0;
        let organicSessions = 0;

        const channels: { channel: string; sessions: number }[] = [];

        for (const row of rows) {
            const channel = row.dimensionValues?.[0]?.value ?? "Unknown";
            const sessions = parseInt(row.metricValues?.[0]?.value ?? "0", 10);
            const users = parseInt(row.metricValues?.[1]?.value ?? "0", 10);
            const bounce = parseFloat(row.metricValues?.[2]?.value ?? "0");
            const duration = parseFloat(row.metricValues?.[3]?.value ?? "0");
            const pageviews = parseInt(row.metricValues?.[4]?.value ?? "0", 10);
            const conversions = parseInt(row.metricValues?.[5]?.value ?? "0", 10);

            totalSessions += sessions;
            totalUsers += users;
            totalBounce += bounce * sessions;
            totalDuration += duration * sessions;
            totalPageviews += pageviews;
            totalConversions += conversions;

            if (channel.toLowerCase().includes("organic")) {
                organicSessions += sessions;
            }

            channels.push({ channel, sessions });
        }

        const avgBounce = totalSessions > 0 ? totalBounce / totalSessions : 0;
        const avgDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;

        channels.sort((a, b) => b.sessions - a.sessions);

        const topPages = await fetchTopPages(accessToken, propertyId, days);

        return {
            sessions: totalSessions,
            users: totalUsers,
            bounceRate: parseFloat((avgBounce * 100).toFixed(1)),
            avgSessionDuration: parseFloat(avgDuration.toFixed(1)),
            pageviews: totalPageviews,
            conversions: totalConversions,
            topPages,
            topChannels: channels.slice(0, 8).map((c) => ({
                channel: c.channel,
                sessions: c.sessions,
                pct: totalSessions > 0 ? parseFloat(((c.sessions / totalSessions) * 100).toFixed(1)) : 0,
            })),
            organicSessions,
            organicPct: totalSessions > 0
                ? parseFloat(((organicSessions / totalSessions) * 100).toFixed(1))
                : 0,
        };
    } catch (e: unknown) {
        logger.warn("[GA4] Fetch failed", { error: (e as Error)?.message });
        return null;
    }
}

async function fetchTopPages(
    accessToken: string,
    propertyId: string,
    days: number
): Promise<{ path: string; views: number; avgTime: number }[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    try {
        const res = await fetch(
            `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
                    metrics: [
                        { name: "screenPageViews" },
                        { name: "averageSessionDuration" },
                    ],
                    dimensions: [{ name: "pagePath" }],
                    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
                    limit: 10,
                }),
                signal: AbortSignal.timeout(10_000),
            }
        );

        if (!res.ok) return [];

        const data = await res.json();
        return (data.rows ?? []).map((row: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }) => ({
            path: row.dimensionValues?.[0]?.value ?? "/",
            views: parseInt(row.metricValues?.[0]?.value ?? "0", 10),
            avgTime: parseFloat(row.metricValues?.[1]?.value ?? "0"),
        }));
    } catch {
        return [];
    }
}

export async function listGa4Properties(
    accessToken: string
): Promise<{ id: string; displayName: string }[]> {
    try {
        const res = await fetch(
            "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(10_000),
            }
        );

        if (!res.ok) return [];

        const data = await res.json();
        const properties: { id: string; displayName: string }[] = [];

        for (const account of data.accountSummaries ?? []) {
            for (const prop of account.propertySummaries ?? []) {
                const id = (prop.property as string)?.replace("properties/", "") ?? "";
                properties.push({ id, displayName: prop.displayName ?? id });
            }
        }

        return properties;
    } catch {
        return [];
    }
}
