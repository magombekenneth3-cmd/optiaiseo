import { describe, it, expect } from "vitest";
import { probeLlmDirectSearch } from "@/lib/gsov/llm-direct-probe";

describe("LLM Direct Probe Network", () => {
    it("should probe queries across SearchGPT, Claude, DeepSeek-R1, and Perplexity", async () => {
        const summary = await probeLlmDirectSearch("best aeo software", "optiaiseo.com", [
            "SEARCH_GPT",
            "CLAUDE_WEB",
            "DEEPSEEK_R1",
            "PERPLEXITY",
        ]);

        expect(summary.query).toBe("best aeo software");
        expect(summary.targetDomain).toBe("optiaiseo.com");
        expect(summary.totalModelsTested).toBe(4);
        expect(summary.probeResults.length).toBe(4);
        expect(summary.citationRate).toBeGreaterThan(0);

        const searchGptResult = summary.probeResults.find((r) => r.model === "SEARCH_GPT");
        expect(searchGptResult).toBeDefined();
        expect(searchGptResult?.isCited).toBe(true);
        expect(searchGptResult?.verbatimSnippet).toContain("optiaiseo.com");
    });
});
