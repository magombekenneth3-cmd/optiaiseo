/**
 * VoiceDiscoveryButtonClient
 * ─────────────────────────────────────────────────────────────────────────────
 * Client-side wrapper that holds the `dynamic({ ssr: false })` call.
 *
 * Next.js 15 rule: `dynamic({ ssr: false })` is only permitted inside Client
 * Components. This thin wrapper satisfies that constraint, allowing the parent
 * Server Component (dashboard/layout.tsx) to import it without error.
 */
"use client";

import dynamic from "next/dynamic";

const VoiceDiscoveryButton = dynamic(
  () =>
    import("@/components/dashboard/VoiceDiscoveryButton").then(
      (m) => m.VoiceDiscoveryButton
    ),
  { ssr: false }
);

export type { } // keep as module

export function VoiceDiscoveryButtonClient({
  userTier,
}: {
  userTier: string;
}) {
  return <VoiceDiscoveryButton userTier={userTier} />;
}
