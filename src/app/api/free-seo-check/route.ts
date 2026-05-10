
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { checkRateLimit } from "@/lib/rate-limit/monthly";

const MAX_BODY_BYTES = 500_000; // 500 KB — enough for any real page
const FETCH_TIMEOUT_MS = 10_000;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60 * 24 * 30; // 30 days
const RATE_LIMIT_COUNT = 1; // one free check per IP+device

// Rejects requests that would make the server call itself or internal services.
const PRIVATE_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // RFC-1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC-1918
  /^192\.168\./, // RFC-1918
  /^169\.254\./, // link-local / GCP metadata
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 unique-local
  /^fe80:/i, // IPv6 link-local
  /^0\./, // "this" network
  /^localhost$/i,
  /\.internal$/i,
  /\.local$/i,
  /^metadata\.google\.internal$/i,
];

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some((re) => re.test(hostname));
}

function assertSafeRedirect(resolvedUrl: string): void {
  try {
    const h = new URL(resolvedUrl).hostname;
    if (isPrivateHost(h)) throw new Error(`Redirected to private host: ${h}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Redirected")) throw e;
  }
}

// Combines User-Agent + Accept-Language into a short hash.
// Not cryptographically identifying — just friction against trivial bypass.
function deviceFingerprint(req: NextRequest): string {
  const ua = req.headers.get("user-agent") ?? "";
  const lang = req.headers.get("accept-language") ?? "";
  return createHash("sha256")
    .update(ua + "\x00" + lang)
    .digest("hex")
    .slice(0, 16);
}

function clientIp(req: NextRequest): string {
  // Trust the first value of X-Forwarded-For (set by Vercel/Cloud Run proxy).
  // Slice to avoid header injection: "1.2.3.4, attacker-controlled-value".
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

function errRes(
  message: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { error: message, ...extra },
    {
      status,
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    }
  );
}

function extractMeta(html: string, name: string): string {
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

function extractTitle(html: string): string {
  // Limit to 500 chars to avoid catastrophic backtracking on adversarial input
  return (
    html
      .match(/<title[^>]{0,200}>([\s\S]{0,500})<\/title>/i)?.[1]
      ?.trim()
      .replace(/\s+/g, " ") ?? ""
  );
}

function extractH1(html: string): string {
  return (
    html
      .match(/<h1[^>]{0,200}>([\s\S]{0,300})<\/h1>/i)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .trim()
      .slice(0, 200) ?? ""
  );
}

function extractCanonical(html: string): string {
  return (
    html
      .match(
        /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']{0,500})["']/i
      )?.[1]
      ?.trim() ??
    html
      .match(
        /<link[^>]+href=["']([^"']{0,500})["'][^>]+rel=["']canonical["']/i
      )?.[1]
      ?.trim() ??
    ""
  );
}

function hasViewport(html: string): boolean {
  return /<meta[^>]+name=["']viewport["']/i.test(html);
}

function hasHreflang(html: string): boolean {
  return /<link[^>]+hreflang=/i.test(html);
}

function hasStructuredData(html: string): boolean {
  return html.includes("application/ld+json");
}

function hasRobotsMeta(html: string): string {
  return (
    html
      .match(
        /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']{0,100})["']/i
      )?.[1]
      ?.toLowerCase() ?? "index, follow"
  );
}

function countImages(html: string): { total: number; missingAlt: number } {
  const imgs = [...html.matchAll(/<img[^>]{0,500}>/gi)];
  const missingAlt = imgs.filter(
    (m) => !/alt=["'][^"']+["']/i.test(m[0])
  ).length;
  return { total: imgs.length, missingAlt };
}

interface Issue {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface CheckResult {
  url: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  issues: Issue[];
  summary: string;
  checkedAt?: string;
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  const fingerprint = deviceFingerprint(req);
  const rateLimitKey = `free-seo-check:${ip}:${fingerprint}`;

  let rlResult;
  try {
    rlResult = await checkRateLimit(
      rateLimitKey,
      RATE_LIMIT_COUNT,
      RATE_LIMIT_WINDOW_SECONDS
    );
  } catch {
    // Redis unavailable — fail closed in production, open in dev
    if (process.env.NODE_ENV === "production") {
      return errRes(
        "Service temporarily unavailable. Please try again shortly.",
        503
      );
    }
    rlResult = { allowed: true, remaining: 0, resetAt: new Date() };
  }

  if (!rlResult.allowed) {
    const resetDate = rlResult.resetAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return errRes(
      `You have already used your free SEO check. Sign up for a free account to run unlimited checks.`,
      429,
      { resetAt: rlResult.resetAt.toISOString(), resetDate }
    );
  }

  const rawUrl = req.nextUrl.searchParams.get("url") ?? "";
  if (!rawUrl || rawUrl.length > 2048) {
    return errRes("A valid url parameter is required (max 2048 chars).", 400);
  }

  let targetUrl: URL;
  try {
    const normalised = rawUrl.trim().startsWith("http")
      ? rawUrl.trim()
      : `https://${rawUrl.trim()}`;
    targetUrl = new URL(normalised);
  } catch {
    return errRes("Invalid URL format.", 400);
  }

  // Only allow http/https — no file://, ftp://, data:, etc.
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return errRes("Only http and https URLs are supported.", 400);
  }

  // Reject URLs with embedded credentials
  if (targetUrl.username || targetUrl.password) {
    return errRes("URLs with credentials are not supported.", 400);
  }

  if (isPrivateHost(targetUrl.hostname)) {
    return errRes("That URL is not publicly accessible.", 400);
  }

  let html = "";
  let finalUrl = targetUrl.href;

  try {
    const resp = await fetch(targetUrl.href, {
      headers: {
        "User-Agent": "OptiAISEO-FreeSEOChecker/1.0 (+https://optiaiseo.online)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    assertSafeRedirect(resp.url);
    finalUrl = resp.url;

    // Guard against non-HTML responses (JSON APIs, images, etc.)
    const contentType = resp.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return errRes("That URL does not return an HTML page.", 422);
    }

    // Read with a size cap — avoids loading huge pages into memory
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body");

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        reader.cancel();
        break; // analyse what we have — enough for SEO checks
      }
      chunks.push(value);
    }

    html = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.length + chunk.length);
        merged.set(acc);
        merged.set(chunk, acc.length);
        return merged;
      }, new Uint8Array(0))
    );
  } catch (err) {
    // Don't leak internal error details to the client
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return errRes(
      isTimeout
        ? "That page took too long to respond (over 10 seconds)."
        : "Could not fetch that URL. Ensure it is publicly accessible.",
      422
    );
  }

  const title = extractTitle(html);
  const metaDesc = extractMeta(html, "description");
  const h1 = extractH1(html);
  const canonical = extractCanonical(html);
  const viewport = hasViewport(html);
  const hreflang = hasHreflang(html);
  const structuredData = hasStructuredData(html);
  const robotsMeta = hasRobotsMeta(html);
  const { total: imgTotal, missingAlt } = countImages(html);
  const noindex = robotsMeta.includes("noindex");

  const issues: Issue[] = [];
  let score = 100;

  // Title
  if (!title) {
    issues.push({
      id: "title",
      label: "Page Title",
      status: "fail",
      detail:
        "No <title> tag found. This is critical — Google uses it as the main search result heading.",
    });
    score -= 15;
  } else if (title.length < 30 || title.length > 60) {
    issues.push({
      id: "title",
      label: "Page Title",
      status: "warn",
      detail: `Title is ${title.length} characters. Ideal length is 30–60 characters.`,
    });
    score -= 5;
  } else {
    issues.push({
      id: "title",
      label: "Page Title",
      status: "pass",
      detail: `"${title.slice(0, 60)}" (${title.length} chars) ✓`,
    });
  }

  // Meta description
  if (!metaDesc) {
    issues.push({
      id: "meta-desc",
      label: "Meta Description",
      status: "fail",
      detail:
        "No meta description found. Google may auto-generate one — usually poorly.",
    });
    score -= 12;
  } else if (metaDesc.length > 155) {
    issues.push({
      id: "meta-desc",
      label: "Meta Description",
      status: "warn",
      detail: `Meta description is ${metaDesc.length} characters. Google truncates above ~155 chars.`,
    });
    score -= 4;
  } else {
    issues.push({
      id: "meta-desc",
      label: "Meta Description",
      status: "pass",
      detail: `${metaDesc.length} characters — within the recommended 100–155 range ✓`,
    });
  }

  // H1
  if (!h1) {
    issues.push({
      id: "h1",
      label: "H1 Heading",
      status: "fail",
      detail:
        "No H1 heading found. Every page should have exactly one H1 that includes your target keyword.",
    });
    score -= 10;
  } else if (h1.length > 70) {
    issues.push({
      id: "h1",
      label: "H1 Heading",
      status: "warn",
      detail: `H1 is ${h1.length} characters. Keep it under 70 for best results.`,
    });
    score -= 3;
  } else {
    issues.push({
      id: "h1",
      label: "H1 Heading",
      status: "pass",
      detail: `"${h1.slice(0, 60)}" (${h1.length} chars) ✓`,
    });
  }

  // Canonical
  if (!canonical) {
    issues.push({
      id: "canonical",
      label: "Canonical Tag",
      status: "warn",
      detail:
        'No canonical tag. Add <link rel="canonical"> to prevent duplicate content penalties.',
    });
    score -= 6;
  } else {
    issues.push({
      id: "canonical",
      label: "Canonical Tag",
      status: "pass",
      detail: `Points to ${canonical.slice(0, 80)} ✓`,
    });
  }

  // Mobile viewport
  if (!viewport) {
    issues.push({
      id: "viewport",
      label: "Mobile Viewport",
      status: "fail",
      detail:
        "No viewport meta tag. Your page will fail Google's mobile-friendliness test — a ranking signal.",
    });
    score -= 12;
  } else {
    issues.push({
      id: "viewport",
      label: "Mobile Viewport",
      status: "pass",
      detail: "Viewport meta tag present ✓",
    });
  }

  // Noindex
  if (noindex) {
    issues.push({
      id: "noindex",
      label: "Indexability",
      status: "fail",
      detail:
        "Page has noindex set. Google will not include this page in search results at all.",
    });
    score -= 20;
  } else {
    issues.push({
      id: "noindex",
      label: "Indexability",
      status: "pass",
      detail: "Page is set to allow indexing ✓",
    });
  }

  // Structured data
  if (!structuredData) {
    issues.push({
      id: "schema",
      label: "Structured Data (Schema)",
      status: "warn",
      detail:
        "No JSON-LD schema found. Schema helps Google and AI engines understand your content and show rich results.",
    });
    score -= 5;
  } else {
    issues.push({
      id: "schema",
      label: "Structured Data (Schema)",
      status: "pass",
      detail: "JSON-LD schema markup detected ✓",
    });
  }

  // Hreflang (informational only — no score impact for single-language sites)
  issues.push({
    id: "hreflang",
    label: "Hreflang / Multilingual",
    status: hreflang ? "pass" : "warn",
    detail: hreflang
      ? "Hreflang tags found ✓"
      : "No hreflang tags. Required only for multilingual or multi-region sites.",
  });

  // Image alt text
  if (imgTotal > 0 && missingAlt > 0) {
    const severity = missingAlt > imgTotal / 2 ? "fail" : "warn";
    issues.push({
      id: "alt-text",
      label: "Image Alt Text",
      status: severity,
      detail: `${missingAlt} of ${imgTotal} images are missing alt text. Alt text improves accessibility and Google Images rankings.`,
    });
    score -= Math.min(missingAlt * 2, 10);
  } else if (imgTotal > 0) {
    issues.push({
      id: "alt-text",
      label: "Image Alt Text",
      status: "pass",
      detail: `All ${imgTotal} images have alt text ✓`,
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade: CheckResult["grade"] =
    score >= 85
      ? "A"
      : score >= 70
      ? "B"
      : score >= 55
      ? "C"
      : score >= 40
      ? "D"
      : "F";

  const failing = issues.filter((i) => i.status === "fail").length;
  const warning = issues.filter((i) => i.status === "warn").length;
  const summary =
    failing === 0 && warning === 0
      ? "Excellent — no major issues found on this page."
      : failing > 0
      ? `${failing} critical issue${failing !== 1 ? "s" : ""} found that need immediate attention.`
      : `${warning} areas for improvement identified.`;

  const result: CheckResult = {
    url: finalUrl,
    score,
    grade,
    issues,
    summary,
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/free-seo-check
// Onboarding quick-check — 5 parallel checks in < 8 s.
// Body: { domain: string }
// Returns: { titleScore, metaScore, speedScore, httpsOk, aeoScore, lowestKey }
// ═══════════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  let body: { domain?: string };
  try {
    body = await req.json();
  } catch {
    return errRes("Invalid JSON body.", 400);
  }

  const rawDomain = (body.domain ?? "").trim().replace(/^https?:\/\//, "").split("/")[0];
  if (!rawDomain || rawDomain.length < 3) {
    return errRes("A valid domain is required.", 400);
  }
  if (isPrivateHost(rawDomain)) {
    return errRes("That domain is not publicly accessible.", 400);
  }

  const { runFreeSeoCheck } = await import("@/lib/seo/free-check");
  try {
    const result = await runFreeSeoCheck(rawDomain);
    return NextResponse.json(
      result,
      { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }
    );
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return errRes(
      isTimeout
        ? "That page took too long to respond (over 10 seconds)."
        : "Could not fetch that URL. Ensure it is publicly accessible.",
      422
    );
  }
}

