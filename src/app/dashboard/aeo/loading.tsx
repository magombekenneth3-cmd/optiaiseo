/**
 * Next.js route-level loading skeleton for the AEO page.
 * Shown while server data is fetched — prevents content shift and
 * removes the blank white flash on the (heavy) AEO client component.
 */
export default function AeoLoading() {
  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-12 animate-pulse">
      {/* Page header skeleton */}
      <div className="flex flex-col gap-2">
        <div className="h-8 w-64 rounded-lg bg-muted" />
        <div className="h-4 w-96 rounded bg-muted/60" />
      </div>

      {/* Summary card skeleton */}
      <div className="card-surface overflow-hidden flex flex-col sm:flex-row">
        <div className="p-8 sm:w-1/3 border-b sm:border-b-0 sm:border-r border-border flex flex-col items-center justify-center gap-4">
          <div className="w-32 h-32 rounded-full bg-muted" />
          <div className="h-5 w-28 rounded bg-muted/60" />
          <div className="h-3 w-32 rounded bg-muted/40" />
        </div>
        <div className="p-8 flex-1 flex flex-col gap-5 justify-center">
          <div className="h-10 w-24 rounded-lg bg-muted" />
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded-full bg-muted shrink-0" />
                <div className="flex-1 h-4 rounded bg-muted/60" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Site rows skeleton */}
      {[0, 1].map((i) => (
        <div key={i} className="card-surface p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-muted shrink-0" />
            <div className="flex flex-col gap-2">
              <div className="h-5 w-40 rounded bg-muted" />
              <div className="h-3 w-32 rounded bg-muted/60" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-24 rounded-lg bg-muted" />
            <div className="h-9 w-28 rounded-lg bg-muted/60" />
          </div>
        </div>
      ))}

      {/* How it works skeleton */}
      <div className="card-surface p-5">
        <div className="h-4 w-24 rounded bg-muted mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2 p-3 rounded-xl border border-border">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-3 w-full rounded bg-muted/50" />
              <div className="h-3 w-5/6 rounded bg-muted/40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
