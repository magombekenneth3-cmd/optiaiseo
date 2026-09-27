"use client";

/**
 * SiteContextBar — persistent per-page site identity strip.
 *
 * Sits between TopHeader and page content. Shows the active site domain,
 * status badge, last-updated timestamp, and a site-switch trigger.
 *
 * Reads siteId from URL (?siteId= or /sites/[id]/) and resolves the domain
 * from the sites prop passed down from the server layout.
 */

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Globe, ChevronDown, CheckCircle, AlertCircle, Plus, Layers } from "lucide-react";
import { GLOBAL_ROUTES, SITE_SCOPED_ROUTES, extractSiteId, isRouteInList } from "@/lib/dashboard/nav-config";

interface Site {
  id: string;
  domain: string;
  grade?: string | null;
}

// The audits list page shows a true cross-site aggregate view when no
// siteId is present in the URL (see AuditSiteSwitcher, which deletes the
// siteId param for "All sites"). Don't let the context bar claim a single
// active site in that state.
const AGGREGATE_ROUTES = ["/dashboard/audits"];

function gradeToStatus(grade: string | null | undefined): {
  label: string;
  color: string;
  icon: "ok" | "warn" | "none";
} {
  if (!grade) return { label: "No grade yet", color: "text-muted-foreground", icon: "none" };
  const upper = grade.toUpperCase();
  if (upper === "A" || upper === "A+") return { label: `Grade ${grade}`, color: "text-emerald-400", icon: "ok" };
  if (upper === "B") return { label: `Grade ${grade}`, color: "text-amber-400", icon: "warn" };
  return { label: `Grade ${grade}`, color: "text-rose-400", icon: "warn" };
}

function SiteContextBarInner({ sites, defaultSiteId }: { sites: Site[]; defaultSiteId: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const explicitSiteId = extractSiteId(pathname) || searchParams.get("siteId") || null;
  const siteId = explicitSiteId || defaultSiteId || null;
  const activeSite = sites.find((s) => s.id === siteId) ?? null;

  // Hide entirely on pages with no site concept at all.
  if (isRouteInList(pathname, GLOBAL_ROUTES) || sites.length === 0) return null;

  // True cross-site aggregate view: no siteId in the URL on a route that
  // treats that as "all sites" rather than "fall back to the default site".
  const isAggregate =
    isRouteInList(pathname, AGGREGATE_ROUTES) && !explicitSiteId && sites.length > 1;

  // Routes that don't actually filter by siteId — the switcher would change
  // the URL without changing what's on screen, so don't offer it here.
  const isScopedRoute = isRouteInList(pathname, SITE_SCOPED_ROUTES);

  const status = gradeToStatus(activeSite?.grade);

  const switchSite = (nextId: string) => {
    setOpen(false);
    if (siteId && siteId !== nextId) {
      const next = new URLSearchParams(searchParams.toString());
      next.set("siteId", nextId);
      router.push(`${pathname}?${next.toString()}`);
    }
  };

  return (
    <div className="relative shrink-0 border-b border-border bg-sidebar/60 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 sm:px-6 md:px-8">
        {/* Site identity */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {isAggregate ? (
            <>
              <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
              <span className="truncate text-xs font-semibold text-foreground">All sites</span>
              <span className="text-xs text-muted-foreground">
                {sites.length} websites · Aggregated
              </span>
            </>
          ) : (
            <>
              <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
              {activeSite ? (
                <>
                  <span className="truncate text-xs font-semibold text-foreground">
                    {activeSite.domain}
                  </span>
                  {activeSite.grade && (
                    <span className="flex items-center gap-1">
                      {status.icon === "ok" ? (
                        <CheckCircle className={`h-3 w-3 ${status.color}`} aria-hidden="true" />
                      ) : status.icon === "warn" ? (
                        <AlertCircle className={`h-3 w-3 ${status.color}`} aria-hidden="true" />
                      ) : null}
                      <span className={`text-xs font-semibold ${status.color}`}>{status.label}</span>
                    </span>
                  )}
                  {!isScopedRoute && (
                    <span className="text-xs text-muted-foreground/60">(not filtered by site)</span>
                  )}
                </>
              ) : (
                <Link
                  href="/dashboard/sites/new"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add a site to get started
                </Link>
              )}
            </>
          )}
        </div>

        {/* Site switcher — only on routes that actually filter by siteId */}
        {isScopedRoute && !isAggregate && sites.length > 1 && activeSite && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-label="Switch site"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Switch
              <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
              <>
                <button
                  type="button"
                  aria-label="Close site switcher"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setOpen(false)}
                />
                <div
                  role="listbox"
                  aria-label="Select site"
                  className="absolute right-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
                >
                  {sites.map((site) => (
                    <button
                      key={site.id}
                      type="button"
                      role="option"
                      aria-selected={site.id === siteId}
                      onClick={() => switchSite(site.id)}
                      className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-accent ${
                        site.id === siteId ? "bg-accent/60" : ""
                      }`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-xs font-bold text-muted-foreground">
                        {site.domain.replace(/^www\./, "").charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{site.domain}</span>
                      {site.id === siteId && (
                        <span className="font-bold text-brand">✓</span>
                      )}
                    </button>
                  ))}
                  <div className="border-t border-border px-3.5 py-2">
                    <Link
                      href="/dashboard/sites/new"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="h-3 w-3" /> Add new site
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Single site: still show a manage link */}
        {sites.length === 1 && activeSite && (
          <Link
            href={`/dashboard/sites/${activeSite.id}`}
            className="text-xs font-medium text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            Manage
          </Link>
        )}
      </div>
    </div>
  );
}

export function SiteContextBar({ sites, defaultSiteId }: { sites: Site[]; defaultSiteId: string | null }) {
  return (
    <Suspense fallback={<div className="h-9 border-b border-border bg-sidebar/60" />}>
      <SiteContextBarInner sites={sites} defaultSiteId={defaultSiteId} />
    </Suspense>
  );
}
