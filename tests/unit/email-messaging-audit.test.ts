/**
 * tests/unit/email-messaging-audit.test.ts
 *
 * Focused tests for the outgoing messaging audit remediation.
 * Covers: HTML escaping, absolute unsubscribe URLs, List-Unsubscribe headers,
 * plain-text fallback, agency dispatcher behavior, and configurable address.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared env setup — ensure NEXTAUTH_URL is NOT set so we test fallback paths
// ---------------------------------------------------------------------------
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Clear URL env vars to test fallbacks
  delete process.env.NEXTAUTH_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_DOMAIN;
  delete process.env.EMAIL_FOOTER_ADDRESS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. HTML escaping in AEO alert templates
// ---------------------------------------------------------------------------
describe("AEO alert HTML escaping", () => {
  it("escapes gainedQueries, lostQueries, and topFix in digest HTML", async () => {
    // We need to test the actual module output. Import dynamically so env is set.
    // The buildDigestHtml is not exported, but sendAeoWeeklyDigest calls it.
    // We'll test by checking the module file content statically.
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/aeo-alert.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // gainedQueries must be escaped
    expect(content).toContain("escapeHtml(q)");
    // Check that the old unescaped pattern is gone
    expect(content).not.toMatch(/`<li>\$\{q\}<\/li>`/);
    // topFix must be escaped
    expect(content).toContain("escapeHtml(data.topFix)");
    // The old unescaped topFix pattern is gone
    expect(content).not.toMatch(/\$\{data\.topFix\}<\/p>/);
  });

  it("escapeHtml function handles all dangerous characters", async () => {
    // Import the module to access escapeHtml (it's file-private, so test via source pattern)
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/aeo-alert.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // The escapeHtml function must exist and handle &, <, >, "
    expect(content).toContain('replace(/&/g, "&amp;")');
    expect(content).toContain('replace(/</g, "&lt;")');
    expect(content).toContain('replace(/>/g, "&gt;")');
    expect(content).toContain('replace(/"/g, "&quot;")');
  });
});

// ---------------------------------------------------------------------------
// 2. Absolute unsubscribe URLs when NEXTAUTH_URL is absent
// ---------------------------------------------------------------------------
describe("Unsubscribe URL fallbacks", () => {
  it("legacy SEO digest HTML uses absolute fallback URL", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/index.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // The legacy digest footer must NOT use raw process.env.NEXTAUTH_URL without fallback
    // It should use the triple-fallback pattern
    const footerMatch = content.match(/process\.env\.NEXTAUTH_URL[^}]*dashboard\/settings/g);
    if (footerMatch) {
      for (const match of footerMatch) {
        // Every occurrence must have a fallback
        expect(match).toContain("??");
      }
    }

    // Must NOT contain a bare `${process.env.NEXTAUTH_URL}/dashboard/settings` without ??
    expect(content).not.toMatch(/\$\{process\.env\.NEXTAUTH_URL\}\/dashboard\/settings[^?]/);
  });

  it("PR notification uses absolute fallback URL", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/pr-notification.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // Must NOT have empty string fallback
    expect(content).not.toContain('NEXTAUTH_URL ?? ""');
    // Must have real fallback
    expect(content).toContain('"https://optiaiseo.online"');
  });

  it("AEO alert uses absolute URL with fallback", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/aeo-alert.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // SITE_URL must have fallback
    expect(content).toContain('process.env.NEXTAUTH_URL ?? "https://optiaiseo.online"');
  });
});

// ---------------------------------------------------------------------------
// 3. Configured production base URL
// ---------------------------------------------------------------------------
describe("Production base URL configuration", () => {
  it("all email files use https://optiaiseo.online as ultimate fallback", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const emailDir = path.resolve(__dirname, "../../src/lib/email");
    const files = fs.readdirSync(emailDir).filter((f: string) => f.endsWith(".ts"));

    for (const file of files) {
      const content = fs.readFileSync(path.join(emailDir, file), "utf-8");
      // Every file that references a URL should have the production fallback
      if (content.includes("NEXTAUTH_URL")) {
        expect(content).toContain("optiaiseo.online");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. List-Unsubscribe headers
// ---------------------------------------------------------------------------
describe("List-Unsubscribe headers", () => {
  it("AEO drop alert includes List-Unsubscribe and List-Unsubscribe-Post headers", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/aeo-alert.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // Both AEO email functions must include unsubscribe headers
    const dropSection = content.slice(content.indexOf("sendAeoDropAlert"));
    expect(dropSection).toContain('"List-Unsubscribe"');
    expect(dropSection).toContain('"List-Unsubscribe-Post"');
    expect(dropSection).toContain('"Precedence"');
  });

  it("AEO weekly digest includes List-Unsubscribe and List-Unsubscribe-Post headers", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/aeo-alert.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    const digestSection = content.slice(content.indexOf("sendAeoWeeklyDigest"));
    expect(digestSection).toContain('"List-Unsubscribe"');
    expect(digestSection).toContain('"List-Unsubscribe-Post"');
  });

  it("PR notification includes List-Unsubscribe-Post header", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/pr-notification.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain('"List-Unsubscribe-Post"');
    expect(content).toContain("List-Unsubscribe=One-Click");
  });

  it("all recurring notification emails have List-Unsubscribe", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const recurringFiles = [
      "../../src/lib/email/aeo-alert.ts",
      "../../src/lib/email/backlink-alert.ts",
      "../../src/lib/email/pr-notification.ts",
      "../../src/lib/email/index.ts",
    ];

    for (const relPath of recurringFiles) {
      const filePath = path.resolve(__dirname, relPath);
      const content = fs.readFileSync(filePath, "utf-8");
      // Every file that calls resend().emails.send or getResend().emails.send
      // with a recurring notification should have List-Unsubscribe
      if (content.includes(".emails.send(")) {
        expect(content).toContain("List-Unsubscribe");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Plain-text AEO output
// ---------------------------------------------------------------------------
describe("AEO plain-text fallback", () => {
  it("sendAeoDropAlert includes text property in send call", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/aeo-alert.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // Find the sendAeoDropAlert function and check it has text property
    const dropFn = content.slice(
      content.indexOf("sendAeoDropAlert"),
      content.indexOf("sendAeoWeeklyDigest")
    );
    expect(dropFn).toContain("text:");
    expect(dropFn).toContain("AEO Score Alert");
  });

  it("sendAeoWeeklyDigest includes text property in send call", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/aeo-alert.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    const digestFn = content.slice(content.indexOf("sendAeoWeeklyDigest"));
    expect(digestFn).toContain("text:");
    expect(digestFn).toContain("Weekly AEO Report");
  });
});

// ---------------------------------------------------------------------------
// 6. Agency dispatcher behavior
// ---------------------------------------------------------------------------
describe("Agency email dispatcher", () => {
  it("fails explicitly when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_DOMAIN;

    const { dispatchWhiteLabelExecutiveDigest } = await import(
      "../../src/lib/agency/email-dispatcher"
    );

    const result = await dispatchWhiteLabelExecutiveDigest({
      recipientEmail: "client@example.com",
      clientSiteName: "example.com",
      agencyName: "Test Agency",
      customDomain: "",
      pdfBufferLength: 1024,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.messageId).toBe("");
  });

  it("does not return fake success when email is not configured", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/agency/email-dispatcher.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // Must NOT contain fake messageId patterns
    expect(content).not.toContain("msg-fallback-");
    expect(content).not.toContain("msg-live-");
    // Must NOT return success:true when API key is missing
    expect(content).not.toMatch(/success:\s*true[^}]*messageId:\s*`msg-fallback/);
  });
});

// ---------------------------------------------------------------------------
// 7. No fake physical address
// ---------------------------------------------------------------------------
describe("Physical address compliance", () => {
  it("does not contain Apple's address", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const emailDir = path.resolve(__dirname, "../../src/lib/email");
    const files = fs.readdirSync(emailDir).filter((f: string) => f.endsWith(".ts"));

    for (const file of files) {
      const content = fs.readFileSync(path.join(emailDir, file), "utf-8");
      expect(content).not.toContain("Infinity Loop");
      expect(content).not.toContain("Cupertino");
    }
  });

  it("uses configurable EMAIL_FOOTER_ADDRESS in AEO alerts", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/aeo-alert.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("EMAIL_FOOTER_ADDRESS");
    // Must escape the address
    expect(content).toContain("escapeHtml(FOOTER_ADDRESS)");
  });
});

// ---------------------------------------------------------------------------
// 8. Branding consistency
// ---------------------------------------------------------------------------
describe("Branding consistency", () => {
  it("Slack webhook uses OptiAISEO not AISEO", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/alerts/webhook-dispatcher.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("OptiAISEO");
    expect(content).not.toMatch(/\*AISEO ·/);
  });

  it("Unsubscribe page uses OptiAISEO not AISEO", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/app/api/unsubscribe/route.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("OptiAISEO");
    expect(content).not.toMatch(/from AISEO\./);
  });
});

// ---------------------------------------------------------------------------
// 9. Audit Complete classification
// ---------------------------------------------------------------------------
describe("Audit Complete email classification", () => {
  it("is documented as transactional (one-time, user-triggered)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../../src/lib/email/index.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // The audit-complete footer must clearly state it's a one-time user-triggered notification
    const auditSection = content.slice(content.indexOf("sendAuditCompleteEmail"));
    expect(auditSection).toContain("one-time");
  });
});
