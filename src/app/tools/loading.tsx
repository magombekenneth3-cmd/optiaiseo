import { MarketingNav } from "@/components/marketing/MarketingNav";
import SiteFooter from "@/components/marketing/SiteFooter";

export default function Loading() {
  return (
    <>
      <MarketingNav />
      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="animate-pulse space-y-4 mb-10">
          <div className="h-6 w-48 bg-muted rounded-full" />
          <div className="h-9 w-2/3 bg-muted rounded-xl" />
          <div className="h-4 w-full bg-muted rounded-lg" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-border rounded-xl p-4 space-y-2 animate-pulse">
              <div className="h-4 w-16 bg-muted rounded-full" />
              <div className="h-5 w-full bg-muted rounded-lg" />
              <div className="h-3 w-3/4 bg-muted rounded" />
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
