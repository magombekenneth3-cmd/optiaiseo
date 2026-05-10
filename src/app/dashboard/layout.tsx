import Link from "next/link";
import { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { CollapsibleSidebar } from "@/components/dashboard/CollapsibleSidebar";
import { TopHeader } from "@/components/dashboard/TopHeader";
import { MobileSidebar } from "@/components/dashboard/MobileSidebar";
import { MobileBottomNav } from "@/components/dashboard/MobileBottomNav";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChatOpsTerminal } from "@/components/dashboard/ChatOps";
import { OnboardingWizard } from "@/components/dashboard/OnboardingWizard";
import { CommandPalette } from "@/components/dashboard/CommandPalette";

import { SiteContextCallout } from "@/components/dashboard/SiteContextCallout";
import { VoiceDiscoveryButtonClient } from "@/components/dashboard/VoiceDiscoveryButtonClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user || !session.user.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      name: true,
      email: true,
      subscriptionTier: true,
      onboardingDone: true,
      trialEndsAt: true,
      role: true,
      sites: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          domain: true,
          aeoReports: {
            where: { status: "COMPLETED", NOT: { grade: { in: ["Pending", "-"] } } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { grade: true },
          },
        },
      },
    },
  });

  if (!user) {
    redirect("/login");
  }

  const userSites: { id: string; domain: string; grade: string | null }[] = user.sites.map((s) => ({
    id: s.id,
    domain: s.domain,
    grade: s.aeoReports[0]?.grade ?? null,
  }));

  const defaultSiteId = userSites[0]?.id ?? null;

  const userName = user.name || "User";
  const effectiveTier = await (await import("@/lib/stripe/guards")).getEffectiveTier(user.id);

  const PLAN_LABELS: Record<string, string> = {
    AGENCY:  "Agency Plan",
    PRO:     "Pro Plan",
    STARTER: "Starter Plan",
  };
  const userPlan = PLAN_LABELS[effectiveTier] ?? "Free Plan";

  // ── Trial banner logic ────────────────────────────────────────────────────
  // Moved OUTSIDE <main> — renders flush edge-to-edge between TopHeader and main
  const trialBanner = (() => {
    if (effectiveTier !== "FREE" || !user.trialEndsAt) return null;
    const now = new Date();
    const trialEnd = new Date(user.trialEndsAt);
    const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // Only show banner in the final 3 days — let users experience value before the pitch
    if (daysLeft > 3) return null;

    // Expired (daysLeft <= 0)
    if (daysLeft <= 0) {
      return (
        <div className="w-full bg-rose-500/10 border-b border-rose-500/20 px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <p className="text-xs text-rose-400 font-medium flex-1 min-w-0">
            <span className="font-bold">Your free trial has ended.</span>{" "}
            Upgrade to continue — your data is preserved for 30 days.
          </p>
          <a
            href="/dashboard/billing"
            className="shrink-0 self-start sm:self-auto text-xs font-bold px-4 py-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 shadow-md transition-all active:scale-95 whitespace-nowrap"
          >
            Upgrade now &rarr;
          </a>
        </div>
      );
    }

    // Days 2–1: urgent amber-to-rose
    if (daysLeft <= 2) {
      return (
        <div className="w-full bg-rose-500/10 border-b border-rose-500/20 px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 shadow-[0_4px_24px_-8px_rgba(239,68,68,0.2)] z-10 relative">
          <p className="text-xs text-rose-400 font-medium flex-1 min-w-0">
            <span className="font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />{" "}
              {daysLeft === 1 ? "Your Pro trial ends tomorrow" : `Your Pro trial ends in ${daysLeft} days`}
            </span>{" "}
            — your audit history and keyword rankings will be locked.
          </p>
          <a
            href="/dashboard/billing"
            className="shrink-0 self-start sm:self-auto text-xs font-bold px-4 py-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 shadow-md transition-all active:scale-95 whitespace-nowrap"
          >
            Upgrade now &rarr;
          </a>
        </div>
      );
    }

    // Days 4–3: soft amber
    return (
      <div className="w-full bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <p className="text-xs text-amber-400 font-medium flex-1 min-w-0">
          <span className="font-bold">Pro Trial Active</span> — your trial ends in{" "}
          <span className="font-bold">{daysLeft} day{daysLeft !== 1 ? "s" : ""}</span>. Keep unlimited access.
        </p>
        <a
          href="/dashboard/billing"
          className="shrink-0 self-start sm:self-auto text-xs font-bold px-3 py-1 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 transition-colors whitespace-nowrap"
        >
          See what&apos;s included &rarr;
        </a>
      </div>
    );
  })();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <CollapsibleSidebar
        defaultSiteId={defaultSiteId}
        sites={userSites}
        isSuperAdmin={user.role === "SUPER_ADMIN"}
        user={{ name: userName, email: user.email || "", tier: userPlan }}
      />

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Header */}
        <TopHeader
          mobileSidebar={
            <MobileSidebar
              userName={userName}
              userTier={userPlan}
              defaultSiteId={defaultSiteId}
              sites={userSites}
              isSuperAdmin={user.role === "SUPER_ADMIN"}
            />
          }
        />

        {/* Trial banner — flush full-width between header and main */}
        {trialBanner}

        {/* Site context callout — shown on site-dependent pages with no active site */}
        <SiteContextCallout
          hasSites={userSites.length > 0}
          hasActiveSite={defaultSiteId !== null}
        />

        {/* Page Content */}
        <main
          id="main-content"
          className="flex-1 p-4 md:p-8 main-content"
        >
          {children}
        </main>

        <ChatOpsTerminal />

        {/* 4.3: Mobile bottom tab bar */}
        <MobileBottomNav
          userName={userName}
          userTier={userPlan}
          defaultSiteId={defaultSiteId}
          sites={userSites}
          isSuperAdmin={user.role === "SUPER_ADMIN"}
        />
      </div>

      {/* Note: Global <Toaster> lives in ClientLayout.tsx — no second instance needed here */}


      {/* Onboarding wizard — shown on first dashboard visit, dismissed after setup */}
      <OnboardingWizard show={!user.onboardingDone && userSites.length > 0} userName={userName} />

      {/* ⌘K Command palette — global navigation shortcut */}
      <CommandPalette />

      {/* Voice AI discovery — floating bottom-right for PRO/AGENCY */}
      <VoiceDiscoveryButtonClient userTier={effectiveTier} />
    </div>
  );
}
