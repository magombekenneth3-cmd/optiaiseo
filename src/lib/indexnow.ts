import { logger, formatError } from "@/lib/logger";

export type IndexNowEngine = "BING" | "YANDEX" | "NAVER";

const ENDPOINTS: Record<IndexNowEngine, string> = {
  BING: "https://api.indexnow.org/indexnow",
  YANDEX: "https://yandex.com/indexnow",
  NAVER: "https://searchadvisor.naver.com/indexnow",
};

const FETCH_TIMEOUT_MS = 10_000;

export interface IndexNowResult {
  engine: IndexNowEngine;
  success: boolean;
  statusCode?: number;
  message?: string;
}

export async function submitToIndexNow(
  engine: IndexNowEngine,
  host: string,
  apiKey: string,
  urls: string[]
): Promise<IndexNowResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const endpoint = ENDPOINTS[engine];
    const body = { host, key: apiKey, urlList: urls.slice(0, 10_000) };

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (res.ok || res.status === 202) {
      return { engine, success: true, statusCode: res.status };
    }

    const text = await res.text().catch(() => "");
    logger.error("[indexnow] Submission failed", { engine, status: res.status, text });
    return { engine, success: false, statusCode: res.status, message: text };
  } catch (err: unknown) {
    clearTimeout(timeout);
    logger.error("[indexnow] Network error", { engine, error: formatError(err) });
    return { engine, success: false, message: formatError(err) };
  }
}

export async function submitToAllIndexNow(
  host: string,
  apiKey: string,
  urls: string[],
  engines: IndexNowEngine[] = ["BING", "YANDEX", "NAVER"]
): Promise<IndexNowResult[]> {
  return Promise.all(
    engines.map((engine) => submitToIndexNow(engine, host, apiKey, urls))
  );
}