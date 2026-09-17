"use client";

import { Globe2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Site = { id: string; domain: string };

export function AuditSiteSwitcher({ sites, selectedSiteId }: { sites: Site[]; selectedSiteId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const changeSite = (siteId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (siteId === "all") params.delete("siteId");
    else params.set("siteId", siteId);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <label className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <Globe2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      <span className="sr-only">Choose site</span>
      <select
        value={selectedSiteId ?? "all"}
        onChange={(event) => changeSite(event.target.value)}
        className="max-w-48 cursor-pointer truncate bg-transparent font-medium text-foreground outline-none sm:max-w-64"
        aria-label="Choose site"
      >
        <option value="all">All sites</option>
        {sites.map((site) => <option key={site.id} value={site.id}>{site.domain}</option>)}
      </select>
    </label>
  );
}
