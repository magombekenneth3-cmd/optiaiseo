/**
 * DashboardClientWidgets
 * ─────────────────────────────────────────────────────────────────────────────
 * Client-side wrapper that holds ALL `dynamic({ ssr: false })` calls needed
 * by dashboard/page.tsx.
 *
 * Next.js 15 rule: `dynamic({ ssr: false })` is only permitted inside Client
 * Components. This single file satisfies that constraint so the parent Server
 * Component (dashboard/page.tsx) can import typed passthrough components.
 */
"use client";

import dynamic from "next/dynamic";

/* ── WinCelebrationToast ─────────────────────────────────────────────────── */
const WinCelebrationToastInner = dynamic(
  () =>
    import("@/components/dashboard/WinCelebrationToast").then(
      (m) => m.WinCelebrationToast
    ),
  { ssr: false }
);

export function WinCelebrationToast({
  keyword,
  delta,
  newPosition,
  winId,
}: {
  keyword: string;
  delta: number;
  newPosition: number;
  winId: string;
}) {
  return (
    <WinCelebrationToastInner
      keyword={keyword}
      delta={delta}
      newPosition={newPosition}
      winId={winId}
    />
  );
}

/* ── ReAuditNudge ────────────────────────────────────────────────────────── */
const ReAuditNudgeInner = dynamic(
  () =>
    import("@/components/dashboard/ReAuditNudge").then((m) => m.ReAuditNudge),
  { ssr: false }
);

export function ReAuditNudge({
  daysSince,
  siteId,
  siteUrl,
}: {
  daysSince: number;
  siteId: string;
  siteUrl: string;
}) {
  return (
    <ReAuditNudgeInner daysSince={daysSince} siteId={siteId} siteUrl={siteUrl} />
  );
}
