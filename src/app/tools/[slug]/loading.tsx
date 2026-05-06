import { MarketingNav } from "@/components/marketing/MarketingNav";
import SiteFooter from "@/components/marketing/SiteFooter";

export default function Loading() {
  return (
    <>
      <MarketingNav />
      <main className="max-w-3xl mx-auto px-4 py-12">
        <div className="animate-pulse space-y-6">
          <div className="h-4 w-32 bg-muted rounded-full" />
          <div className="h-8 w-3/4 bg-muted rounded-xl" />
          <div className="h-4 w-full bg-muted rounded-lg" />
          <div className="h-4 w-5/6 bg-muted rounded-lg" />
          <div className="space-y-4 mt-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="border border-border rounded-2xl p-6 space-y-3">
                <div className="h-5 w-2/3 bg-muted rounded-lg" />
                <div className="h-4 w-full bg-muted rounded" />
                <div className="h-4 w-5/6 bg-muted rounded" />
              </div>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
