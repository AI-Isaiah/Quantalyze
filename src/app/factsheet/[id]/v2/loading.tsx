/**
 * Loading skeleton for the factsheet v2 route — shown while the server-side
 * `buildFactsheetPayload()` runs (bootstrap CI + signature compute alone is
 * ~150ms on a 1000-day series). Keeps the layout dimensions stable so the
 * page doesn't jump when content arrives.
 */
export default function FactsheetV2Loading() {
  return (
    <article className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 py-6 sm:py-10 lg:py-12 bg-page animate-pulse">
      {/* Header skeleton */}
      <header className="border-b border-text pb-6">
        <div className="h-2 w-44 bg-border rounded-sm" />
        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <div className="h-9 w-72 bg-border rounded-sm" />
            <div className="mt-3 flex gap-3">
              <div className="h-4 w-28 bg-border rounded-sm" />
              <div className="h-4 w-40 bg-border rounded-sm" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-3 w-24 bg-border rounded-sm" />
            <div className="h-4 w-32 bg-border rounded-sm" />
          </div>
        </div>
      </header>

      {/* KPI strip skeleton */}
      <section className="mt-6 border border-border bg-surface">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-9 divide-x divide-border">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="px-4 py-4 space-y-2">
              <div className="h-2 w-16 bg-border rounded-sm" />
              <div className="h-5 w-20 bg-border rounded-sm" />
            </div>
          ))}
        </div>
      </section>

      {/* Body skeleton — chart placeholders + right column */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-x-12 gap-y-10">
        <section className="flex flex-col gap-10 min-w-0">
          <div className="h-16 border border-border rounded-sm" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="h-3 w-40 bg-border rounded-sm" />
              <div className="h-[260px] bg-surface-subtle rounded-sm" />
            </div>
          ))}
        </section>
        <aside className="space-y-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-32 bg-border rounded-sm" />
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="h-4 w-full bg-surface-subtle rounded-sm" />
              ))}
            </div>
          ))}
        </aside>
      </div>

      {/* Screen-reader-only liveness hint while the skeleton is up. */}
      <p className="sr-only" role="status" aria-live="polite">
        Loading factsheet — computing analytics.
      </p>
    </article>
  );
}
