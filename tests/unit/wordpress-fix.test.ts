import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyWordPressSeoFix } from "@/lib/publishers/wordpress";

describe("WordPress SEO Fix via REST Unit Tests", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fails early when WordPress config is incomplete", async () => {
    const res = await applyWordPressSeoFix(
      { schemaMarkup: "<script>{}</script>" },
      { wordPressConfig: {} },
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("incomplete");
  });

  it("fails early when WordPress URL is unsafe SSRF target", async () => {
    const res = await applyWordPressSeoFix(
      { schemaMarkup: "<script>{}</script>" },
      {
        wordPressConfig: {
          wpUrl: "http://169.254.169.254/latest/meta-data",
          wpUser: "admin",
          wpAppPassword: "pwd",
        },
      },
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("blocked: unsafe URL");
  });

  it("applies SEO and schema fix to target post via REST API", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 42 }),
    });

    const res = await applyWordPressSeoFix(
      {
        postId: 42,
        schemaMarkup: '{"@context":"https://schema.org"}',
        metaDescription: "Test description",
        title: "Test Title",
      },
      {
        wordPressConfig: {
          wpUrl: "https://example.com",
          wpUser: "admin",
          wpAppPassword: "app-pass-word",
        },
      },
    );

    expect(res.success).toBe(true);
    expect(res.postId).toBe(42);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/wp-json/wp/v2/posts/42",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});
