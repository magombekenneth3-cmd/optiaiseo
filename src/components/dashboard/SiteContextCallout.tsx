"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Globe } from "lucide-react";

/** Pages that need a site to be selected to be useful */
const SITE_DEPENDENT_PATTERNS = [
  "/dashboard/keywords",
  "/dashboard/audits",
  "/dashboard/aeo/track",
  "/dashboard/content-decay",
  "/dashboard/refresh",
  "/dashboard/planner",
];

interface Props {
  hasSites: boolean;
  hasActiveSite: boolean;
}

/**
 * Renders a dismissible sticky callout when the user is on a site-dependent
 * page but has no active site selected. Replaces the hover-only tooltip approach.
 */
export function SiteContextCallout({ hasSites, hasActiveSite }: Props) {
  const pathname = usePathname();
  const isSiteDependent = SITE_DEPENDENT_PATTERNS.some((p) =>
    pathname.startsWith(p)
  );

  if (!isSiteDependent || hasActiveSite) return null;

  return (
    <div className="border-b border-border bg-amber-500/5 px-6 py-3 flex items-center gap-3 text-sm">
      <div className="w-6 h-6 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
        <Globe className="w-3.5 h-3.5 text-amber-400" />
      </div>
      <p className="text-muted-foreground flex-1 min-w-0">
        {hasSites ? (
          <>
            <span className="font-semibold text-foreground">Select a site</span>
            {" "}from the sidebar to use this feature.
          </>
        ) : (
          <>
            <span className="font-semibold text-foreground">No sites connected yet.</span>{" "}
            <Link
              href="/dashboard/sites/new"
              className="text-amber-400 hover:underline font-medium"
            >
              Add your first domain →
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
