import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkGrokVisibility,
  checkGrokVisibilityWithStatus,
} from "@/lib/aeo/check-grok";
import {
  checkCopilotVisibility,
  checkCopilotVisibilityWithStatus,
} from "@/lib/aeo/check-copilot";
import { getAeoPlatformStatus } from "@/lib/aeo/platform-status";

function response(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("typed AI visibility probes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("marks a missing Grok key as unconfigured, not as observed zero visibility", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await checkGrokVisibilityWithStatus("OptiAISEO", "best SEO tools");

    expect(result).toEqual({ score: null, status: "NO_API_KEY" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks a failed Grok request as unavailable", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("", 503)));

    const result = await checkGrokVisibilityWithStatus("OptiAISEO", "best SEO tools");

    expect(result).toEqual({ score: null, status: "PROVIDER_ERROR" });
  });

  it("records a successful negative Grok result as a measured zero", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("Here are three general SEO tools.")));

    const result = await checkGrokVisibilityWithStatus("OptiAISEO", "best SEO tools");

    expect(result).toEqual({ score: 0, status: "SUCCESS" });
    expect(await checkGrokVisibility("OptiAISEO", "best SEO tools")).toBe(0);
  });

  it("marks an empty Copilot response as NO_RESULT", async () => {
    vi.stubEnv("AZURE_OAI_ENDPOINT", "https://example.openai.azure.com");
    vi.stubEnv("AZURE_OAI_KEY", "test-key");
    vi.stubEnv("BING_SEARCH_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("  ")));

    const result = await checkCopilotVisibilityWithStatus("OptiAISEO", "best SEO tools");

    expect(result).toEqual({ score: null, status: "NO_RESULT" });
  });

  it("marks a successful Copilot mention as measured visibility", async () => {
    vi.stubEnv("AZURE_OAI_ENDPOINT", "https://example.openai.azure.com");
    vi.stubEnv("AZURE_OAI_KEY", "test-key");
    vi.stubEnv("BING_SEARCH_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("OptiAISEO is one option to consider.")));

    const result = await checkCopilotVisibilityWithStatus("OptiAISEO", "best SEO tools");

    expect(result).toEqual({ score: 100, status: "SUCCESS" });
    expect(await checkCopilotVisibility("OptiAISEO", "best SEO tools")).toBe(100);
  });

  it("returns unknown for legacy snapshots without stored platform status", () => {
    expect(getAeoPlatformStatus(null, "Grok", true)).toBe("NOT_RECORDED");
    expect(getAeoPlatformStatus({}, "ChatGPT")).toBe("NOT_RECORDED");
  });

  it("uses a separate visibility probe status for Grok and Copilot", () => {
    const breakdown = {
      Grok: { status: "SUCCESS", visibilityStatus: "NO_API_KEY", visibilityScore: null },
      Copilot: { status: "SUCCESS", visibilityStatus: "PROVIDER_ERROR", visibilityScore: null },
      ChatGPT: { status: "SUCCESS" },
    };

    expect(getAeoPlatformStatus(breakdown, "Grok", true)).toBe("NO_API_KEY");
    expect(getAeoPlatformStatus(breakdown, "Copilot", true)).toBe("PROVIDER_ERROR");
    expect(getAeoPlatformStatus(breakdown, "ChatGPT")).toBe("SUCCESS");
    expect(getAeoPlatformStatus(breakdown, "Grok")).toBe("SUCCESS");
  });
});
