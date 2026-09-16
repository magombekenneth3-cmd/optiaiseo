import { isSafeUrl } from "@/lib/security/safe-url";

export interface IndexabilityEvidence {
  finalUrl: string;
  status: number;
  redirects: number;
  xRobotsTag: string;
  blockedByHeader: boolean;
}

/** Fetches headers with explicit redirect handling so audit evidence names the actual URL crawlers see. */
export async function inspectIndexability(url: string): Promise<IndexabilityEvidence> {
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const safe = isSafeUrl(current);
    if (!safe.ok || !safe.url) throw new Error(`Unsafe indexability URL: ${safe.error ?? current}`);
    const response = await fetch(safe.url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "SEO-Bot/1.0" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect response has no Location header.");
      current = new URL(location, safe.url).href;
      continue;
    }
    const xRobotsTag = response.headers.get("x-robots-tag") ?? "";
    return { finalUrl: safe.url.href, status: response.status, redirects, xRobotsTag, blockedByHeader: /(?:^|[,\s])noindex(?:$|[,\s])/i.test(xRobotsTag) };
  }
  throw new Error("Redirect chain exceeds five hops.");
}
