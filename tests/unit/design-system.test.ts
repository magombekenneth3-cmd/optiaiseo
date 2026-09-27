import { describe, it, expect } from "vitest";
import React from "react";
import { PageHeader } from "@/components/ui/design-system/PageHeader";
import { ScoreCard } from "@/components/ui/design-system/ScoreCard";
import { SystemStatusState } from "@/components/ui/design-system/SystemStatusState";
import { EmptyState } from "@/components/ui/design-system/EmptyState";

describe("Design System Components", () => {
  it("exports PageHeader cleanly", () => {
    expect(PageHeader).toBeDefined();
    expect(typeof PageHeader).toBe("function");
  });

  it("exports ScoreCard cleanly", () => {
    expect(ScoreCard).toBeDefined();
    expect(typeof ScoreCard).toBe("function");
  });

  it("exports SystemStatusState cleanly", () => {
    expect(SystemStatusState).toBeDefined();
    expect(typeof SystemStatusState).toBe("function");
  });

  it("exports EmptyState cleanly", () => {
    expect(EmptyState).toBeDefined();
    expect(typeof EmptyState).toBe("function");
  });
});
