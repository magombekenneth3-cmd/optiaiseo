/**
 * C.1 Operating Modes — Tests
 *
 * Validates:
 * - Mode → tier limit mapping
 * - effectiveTierLimit cannot escalate beyond mode
 * - REPORT_ONLY always returns 0
 * - Unknown modes fail closed
 * - isReportOnly checks
 * - isTierAuthorized logic
 */

import { describe, it, expect } from "vitest";

import {
  modeTierLimit,
  effectiveTierLimit,
  isTierAuthorized,
  isReportOnly,
  parseOperatingMode,
  OPERATING_MODES,
} from "@/lib/autonomy/operating-modes";

describe("§1 Operating Mode Semantics", () => {
  it("REPORT_ONLY has tier limit 0", () => {
    expect(modeTierLimit("REPORT_ONLY")).toBe(0);
  });

  it("SUPERVISED has tier limit 1", () => {
    expect(modeTierLimit("SUPERVISED")).toBe(1);
  });

  it("AUTOPILOT has tier limit 2", () => {
    expect(modeTierLimit("AUTOPILOT")).toBe(2);
  });

  it("unknown mode fails closed (returns 0)", () => {
    expect(modeTierLimit("YOLO" as any)).toBe(0);
  });

  it("OPERATING_MODES contains exactly 3 modes", () => {
    expect(OPERATING_MODES).toHaveLength(3);
    expect(OPERATING_MODES).toContain("REPORT_ONLY");
    expect(OPERATING_MODES).toContain("SUPERVISED");
    expect(OPERATING_MODES).toContain("AUTOPILOT");
  });
});

describe("§2 Effective Tier Limit (ceiling can only restrict, never escalate)", () => {
  it("AUTOPILOT with no ceiling = 2", () => {
    expect(effectiveTierLimit({ operatingMode: "AUTOPILOT" })).toBe(2);
  });

  it("AUTOPILOT with ceiling=1 restricts to 1", () => {
    expect(effectiveTierLimit({ operatingMode: "AUTOPILOT", tierCeiling: 1 })).toBe(1);
  });

  it("SUPERVISED with ceiling=2 cannot escalate beyond 1", () => {
    expect(effectiveTierLimit({ operatingMode: "SUPERVISED", tierCeiling: 2 })).toBe(1);
  });

  it("SUPERVISED with ceiling=3 cannot escalate beyond 1", () => {
    expect(effectiveTierLimit({ operatingMode: "SUPERVISED", tierCeiling: 3 })).toBe(1);
  });

  it("REPORT_ONLY with ceiling=3 cannot escalate beyond 0", () => {
    expect(effectiveTierLimit({ operatingMode: "REPORT_ONLY", tierCeiling: 3 })).toBe(0);
  });

  it("AUTOPILOT with ceiling=0 restricts to 0", () => {
    expect(effectiveTierLimit({ operatingMode: "AUTOPILOT", tierCeiling: 0 })).toBe(0);
  });

  it("null ceiling does not restrict", () => {
    expect(effectiveTierLimit({ operatingMode: "AUTOPILOT", tierCeiling: null })).toBe(2);
  });
});

describe("§3 Tier Authorization", () => {
  it("Tier 1 is authorized under SUPERVISED", () => {
    expect(isTierAuthorized(1, { operatingMode: "SUPERVISED" })).toBe(true);
  });

  it("Tier 2 is NOT authorized under SUPERVISED", () => {
    expect(isTierAuthorized(2, { operatingMode: "SUPERVISED" })).toBe(false);
  });

  it("Tier 2 IS authorized under AUTOPILOT", () => {
    expect(isTierAuthorized(2, { operatingMode: "AUTOPILOT" })).toBe(true);
  });

  it("Tier 3 is NOT authorized under AUTOPILOT", () => {
    expect(isTierAuthorized(3, { operatingMode: "AUTOPILOT" })).toBe(false);
  });

  it("Tier 1 is NOT authorized under REPORT_ONLY", () => {
    expect(isTierAuthorized(1, { operatingMode: "REPORT_ONLY" })).toBe(false);
  });

  it("Tier 0 is authorized under REPORT_ONLY (vacuously)", () => {
    expect(isTierAuthorized(0, { operatingMode: "REPORT_ONLY" })).toBe(true);
  });
});

describe("§4 REPORT_ONLY Enforcement", () => {
  it("isReportOnly returns true for REPORT_ONLY", () => {
    expect(isReportOnly("REPORT_ONLY")).toBe(true);
  });

  it("isReportOnly returns false for SUPERVISED", () => {
    expect(isReportOnly("SUPERVISED")).toBe(false);
  });

  it("isReportOnly returns false for AUTOPILOT", () => {
    expect(isReportOnly("AUTOPILOT")).toBe(false);
  });

  it("isReportOnly returns false for unknown mode", () => {
    expect(isReportOnly("UNKNOWN")).toBe(false);
  });
});

describe("§5 Mode Parsing", () => {
  it("parses valid modes", () => {
    expect(parseOperatingMode("REPORT_ONLY")).toBe("REPORT_ONLY");
    expect(parseOperatingMode("SUPERVISED")).toBe("SUPERVISED");
    expect(parseOperatingMode("AUTOPILOT")).toBe("AUTOPILOT");
  });

  it("returns null for invalid modes", () => {
    expect(parseOperatingMode("YOLO")).toBeNull();
    expect(parseOperatingMode("")).toBeNull();
    expect(parseOperatingMode("autopilot")).toBeNull(); // case-sensitive
  });
});

describe("§6 REPORT_ONLY enforcement in mutation lifecycle", () => {
  it("createOperation imports MutationBlockedError", async () => {
    const { readFileSync } = await import("fs");
    const content = readFileSync(
      "src/lib/mutations/operation.ts",
      "utf-8"
    );

    // Verify the REPORT_ONLY check exists
    expect(content).toContain("REPORT_ONLY");
    expect(content).toContain("MutationBlockedError");

    // Verify it checks actorType SYSTEM and CRON
    expect(content).toContain('actorType === "SYSTEM"');
    expect(content).toContain('actorType === "CRON"');
  });
});
