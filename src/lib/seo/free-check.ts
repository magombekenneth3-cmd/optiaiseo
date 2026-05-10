/**
 * Shared free SEO quick-check logic.
 * Used by:
 *  - POST /api/free-seo-check  (HTTP entry-point)
 *  - src/lib/inngest/functions/magic-first-audit.ts (called directly — no HTTP round-trip)
 *
 * Keeping this in a shared module avoids the fragile server-to-self HTTP fetch pattern.
 */

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^0\./,
  /^localhost$/i,
  /\.internal$/i,
  /\.local$/i,
  /^metadata\.google\.internal$/i,
];

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some((re) => re.test(hostname));
}

export function assertSafeRedirect(resolvedUrl: string): void {
  try {
    const h = new URL(resolvedUrl).hostname;
    if (isPrivateHost(h)) throw new Error(`Redirected to private host: ${h}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Redirected")) throw e;
  }
}

export function extractTitle(html: string): string {
  return (
    html
      .match(/<title[^>]{0,200}>([\s\S]{0,500})<\/title>/i)?.[1]
      ?.trim()
      .replace(/\s+/g, " ") ?? ""
  );
}

export function extractMeta(html: string, name: string): string {
  const m =
    html.match(
      new RegExp(
        `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']{0,500})["']`,
        "i"
      )
    ) ||
    html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']{0,500})["'][^>]+name=["']${name}["']`,
        "i"
      )
    );
  return m?.[1]?.trim() ?? "";
}

export interface FreeSeoCheckResult {
  titleScore: number;
  metaScore: number;
  speedScore: number;
  httpsOk: boolean;
  aeoScore: number;
  lowestKey: string;
}

export async function runFreeSeoCheck(rawDomain: string): Promise<FreeSeoCheckResult> {
  const httpsUrl = `https://${rawDomain}`;
  const timeout = AbortSignal.timeout(7_500);

  const fetchHtml = async (): Promise<{ html: string; isHttps: boolean }> => {
    const httpRes = await fetch(httpsUrl, {
      headers: { "User-Agent": "OptiAISEO-QuickCheck/1.0", Accept: "text/html" },
      redirect: "follow",
      signal: timeout,
    });
    assertSafeRedirect(httpRes.url);
    const ct = httpRes.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      throw new Error("Not HTML");
    }
    const reader = httpRes.body?.getReader();
    if (!reader) throw new Error("No body");
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      totalBytes += value.byteLength;
      if (totalBytes > 200_000) { reader.cancel(); break; }
      chunks.push(value);
    }
    const html = new TextDecoder().decode(
      chunks.reduce((acc, c) => {
        const m = new Uint8Array(acc.length + c.length);
        m.set(acc);
        m.set(c, acc.length);
        return m;
      }, new Uint8Array(0))
    );
    return { html, isHttps: httpRes.url.startsWith("https://") };
  };

  const fetchSpeed = async (): Promise<number> => {
    const psKey = process.env.PAGESPEED_API_KEY;
    const psUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(httpsUrl)}&strategy=mobile${psKey ? `&key=${psKey}` : ""}`;
    const r = await fetch(psUrl, { signal: AbortSignal.timeout(7_000) });
    if (!r.ok) return 60;
    const data = await r.json() as { lighthouseResult?: { categories?: { performance?: { score?: number } } } };
    const raw = data.lighthouseResult?.categories?.performance?.score ?? 0.6;
    return Math.round(raw * 100);
  };

  const fetchAeo = async (): Promise<number> => {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return 50;
    const prompt = `You are an AEO (Answer Engine Optimisation) evaluator. On a scale of 0-100, how well would '${rawDomain}' likely appear in AI-generated answers? Just respond with a single integer, no explanation.`;
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 8, temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(6_000),
      }
    );
    if (!r.ok) return 50;
    const data = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = parseInt(data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "50", 10);
    return Number.isNaN(raw) ? 50 : Math.max(0, Math.min(100, raw));
  };

  const [htmlResult, speedResult, aeoResult] = await Promise.allSettled([
    fetchHtml(),
    fetchSpeed(),
    fetchAeo(),
  ]);

  const htmlData = htmlResult.status === "fulfilled" ? htmlResult.value : null;
  const html = htmlData?.html ?? "";
  const isHttps = htmlData?.isHttps ?? false;

  const title = extractTitle(html);
  const titleOk = title.length >= 30 && title.length <= 60;
  const titleScore = !title ? 20 : titleOk ? 100 : title.length < 30 ? 60 : 70;

  const metaDesc = extractMeta(html, "description");
  const metaOk = metaDesc.length >= 50 && metaDesc.length <= 155;
  const metaScore = !metaDesc ? 20 : metaOk ? 100 : 60;

  const speedScore = speedResult.status === "fulfilled" ? speedResult.value : 60;
  const httpsOk = isHttps;
  const aeoScore = aeoResult.status === "fulfilled" ? aeoResult.value : 50;

  const scores: Record<string, number> = { titleScore, metaScore, speedScore, aeoScore };
  const lowestKey =
    Object.entries(scores)
      .sort(([, a], [, b]) => a - b)[0]?.[0] ?? "titleScore";

  return { titleScore, metaScore, speedScore, httpsOk, aeoScore, lowestKey };
}
