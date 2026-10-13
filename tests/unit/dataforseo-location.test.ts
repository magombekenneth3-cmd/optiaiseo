import { describe, expect, it } from "vitest";
import {
  DATAFORSEO_LOCATION_CODES,
  resolveLocationCode,
} from "@/lib/keywords/dataforseo";

describe("resolveLocationCode", () => {
  it("recognizes country names in a location string", () => {
    expect(resolveLocationCode("Kampala, Uganda")).toBe(DATAFORSEO_LOCATION_CODES.ug);
    expect(resolveLocationCode("Nairobi, Kenya")).toBe(DATAFORSEO_LOCATION_CODES.ke);
  });

  it("recognizes explicitly delimited country codes", () => {
    expect(resolveLocationCode("Kampala, UG")).toBe(DATAFORSEO_LOCATION_CODES.ug);
    expect(resolveLocationCode("en-GB")).toBe(DATAFORSEO_LOCATION_CODES.gb);
  });

  it("does not match country codes inside ordinary words", () => {
    expect(resolveLocationCode("small business SEO")).toBe(DATAFORSEO_LOCATION_CODES.us);
    expect(resolveLocationCode("business, UG")).toBe(DATAFORSEO_LOCATION_CODES.ug);
  });

  it("retains the default for empty or unsupported locations", () => {
    expect(resolveLocationCode(null)).toBe(DATAFORSEO_LOCATION_CODES.us);
    expect(resolveLocationCode("unknown market")).toBe(DATAFORSEO_LOCATION_CODES.us);
  });
});
