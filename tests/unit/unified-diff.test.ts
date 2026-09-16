import { describe, expect, it } from "vitest";
import { applyUnifiedDiff } from "@/lib/audit-fix/unified-diff";

describe("applyUnifiedDiff", () => {
  it("applies a context-verified single-file patch", () => {
    expect(applyUnifiedDiff("one\ntwo\nthree", "@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three")).toBe("one\nTWO\nthree");
  });

  it("rejects a patch whose context does not match the pinned source", () => {
    expect(() => applyUnifiedDiff("one\ntwo", "@@ -1,2 +1,2 @@\n one\n-three\n+TWO")).toThrow(/context/);
  });
});
