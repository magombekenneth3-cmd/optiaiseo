import { Metadata } from "next";
import { getUserAudits } from "@/app/actions/audit";
import { getUserSites } from "@/app/actions/site";
import { AuditButton } from "./AuditButton";
import { AuditPoller } from "./AuditPoller";
import { AuditTable } from "./AuditTable";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Audit Reports | OptiAISEO",
  description: "View your OptiAISEO technical audit history. Audits run automatically after site setup or on demand from the dashboard.",
};

export const dynamic = "force-dynamic";

export default async function AuditsPage() {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email;
  const [{ success, audits, nextCursor }, { sites }, dbUser] = await Promise.all([
    getUserAudits(),
    getUserSites(),
    userEmail ? prisma.user.findUnique({ where: { email: userEmail }, select: { subscriptionTier: true } }) : null,
  ]);
  const userTier = dbUser?.subscriptionTier ?? "FREE";

  const processingIds = (audits ?? [])
    .filter((a) => a.fixStatus === "IN_PROGRESS" || a.fixStatus === "PENDING")
    .map((a) => a.id);

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
      <AuditPoller processingAuditIds={processingIds} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">Audit Reports</h1>
          <p className="text-muted-foreground">Review technical SEO issues found by our autonomous engine.</p>
        </div>
        <AuditButton sites={sites} userTier={userTier} />
      </div>

      {success && (!audits || audits.length === 0) && (
        <div className="card-surface p-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">No audits yet</p>
            Your first audit will appear here once your site setup is complete. If you&apos;ve already added a site and don&apos;t see results within 2 minutes, click <strong>Run Manual Audit</strong> above.
          </div>
        </div>
      )}

      <AuditTable
        initialAudits={(audits ?? []) as Parameters<typeof AuditTable>[0]["initialAudits"]}
        initialCursor={nextCursor ?? null}
      />
    </div>
  );
}
