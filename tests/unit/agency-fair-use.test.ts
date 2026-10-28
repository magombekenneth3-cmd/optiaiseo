import { describe, it, expect } from "vitest";
import { withinLimit, isFairUseExceeded, AGENCY_FAIR_USE_LIMITS } from "@/lib/stripe/plans";

describe("Agency Fair Use & Margin Protection Unit Tests", () => {
  it("allows standard agency operations without artificial limits", () => {
    expect(withinLimit("AGENCY", "sites", 10)).toBe(true);
    expect(withinLimit("AGENCY", "auditsPerMonth", 50)).toBe(true);
    expect(withinLimit("AGENCY", "blogsPerMonth", 100)).toBe(true);
  });

  it("triggers fair use guard when usage exceeds agency fair use limits", () => {
    expect(isFairUseExceeded("AGENCY", "sites", AGENCY_FAIR_USE_LIMITS.sites)).toBe(true);
    expect(withinLimit("AGENCY", "sites", AGENCY_FAIR_USE_LIMITS.sites)).toBe(false);

    expect(isFairUseExceeded("AGENCY", "auditsPerMonth", AGENCY_FAIR_USE_LIMITS.auditsPerMonth + 1)).toBe(true);
    expect(withinLimit("AGENCY", "auditsPerMonth", AGENCY_FAIR_USE_LIMITS.auditsPerMonth + 1)).toBe(false);
  });

  it("does not apply agency fair use limits to other tiers", () => {
    expect(isFairUseExceeded("PRO", "sites", 200)).toBe(false);
    expect(isFairUseExceeded("STARTER", "sites", 200)).toBe(false);
  });
});
