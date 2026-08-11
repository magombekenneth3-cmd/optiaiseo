import { describe, it, expect } from "vitest";
import { geminiAdapter, openAiAdapter, perplexityAdapter, HttpClient } from "@/lib/gsov/llm-adapters";

describe("Direct Provider Adapters Unit Tests (Gate 2)", () => {
    it("Gemini adapter should call Gemini endpoint and return standardized ProbeResult with provenance", async () => {
        let requestedUrl = "";
        let requestedHeaders: Record<string, string> = {};

        const mockClient: HttpClient = {
            fetch: async (url, options) => {
                requestedUrl = url;
                requestedHeaders = (options?.headers as Record<string, string>) || {};
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        candidates: [{
                            content: { parts: [{ text: JSON.stringify({ score: 4, wouldCite: true, reasoning: "Strong E-E-A-T" }) }] },
                            groundingMetadata: { groundingChunks: [{ web: { uri: "https://acme.com/source1" } }] }
                        }]
                    }),
                    text: async () => ""
                };
            }
        };

        const res = await geminiAdapter.probe("keyword", "system prompt", "body data", "test-key", mockClient);

        expect(res).not.toBeNull();
        expect(requestedUrl).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash");
        expect(requestedHeaders["x-goog-api-key"]).toEqual("test-key");
        expect(res?.provider).toEqual("google_gemini");
        expect(res?.score).toEqual(4);
        expect(res?.wouldCite).toBe(true);
        expect(res?.citations).toContain("https://acme.com/source1");
        expect(res?.promptHash).toHaveLength(64);
        expect(res?.responseHash).toHaveLength(64);
    });

    it("OpenAI adapter should call OpenAI chat endpoint with system role separation", async () => {
        let requestedUrl = "";

        const mockClient: HttpClient = {
            fetch: async (url) => {
                requestedUrl = url;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        choices: [{ message: { content: JSON.stringify({ score: 5, wouldCite: true, reasoning: "Clear facts" }) } }]
                    }),
                    text: async () => ""
                };
            }
        };

        const res = await openAiAdapter.probe("keyword", "system prompt", "body data", "openai-key", mockClient);

        expect(res).not.toBeNull();
        expect(requestedUrl).toEqual("https://api.openai.com/v1/chat/completions");
        expect(res?.provider).toEqual("openai");
        expect(res?.score).toEqual(5);
        expect(res?.wouldCite).toBe(true);
    });

    it("Perplexity adapter should call Perplexity endpoint and extract citations", async () => {
        let requestedUrl = "";

        const mockClient: HttpClient = {
            fetch: async (url) => {
                requestedUrl = url;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        choices: [{ message: { content: JSON.stringify({ score: 3, wouldCite: false, reasoning: "Needs depth" }) } }],
                        citations: ["https://perplexity.ai/ref1"]
                    }),
                    text: async () => ""
                };
            }
        };

        const res = await perplexityAdapter.probe("keyword", "system prompt", "body data", "pplx-key", mockClient);

        expect(res).not.toBeNull();
        expect(requestedUrl).toEqual("https://api.perplexity.ai/chat/completions");
        expect(res?.provider).toEqual("perplexity");
        expect(res?.score).toEqual(3);
        expect(res?.wouldCite).toBe(false);
        expect(res?.citations).toContain("https://perplexity.ai/ref1");
    });
});
