/**
 * Shared route-level loading skeleton for the WHOLE /admin subtree (STATE-05).
 *
 * Admin's dominant visual anchor is a data table, so the skeleton is
 * data-table-anchored: a page-title bar + a `border border-border bg-surface`
 * block with a header rule and N placeholder rows, closed by an `sr-only
 * role="status"` liveness hint. A single `animate-pulse` rides the shell
 * wrapper (the sanctioned idiom — not per-element pulses).
 *
 * The server-fetch lives in each admin `page.tsx` body (NOT the dashboard
 * layout), so this fallback renders while `AdminPage` / the sub-pages await
 * their queries (RESEARCH Pitfall 5). The shell does NOT re-impose
 * `max-w-7xl` — `DashboardChrome` owns the measure (Plan 06 widens admin to
 * the fluid-fill ~1920 container).
 */
export default function AdminLoading() {
  return (
    <div className="animate-pulse" data-testid="admin-loading">
      {/* Page-title placeholder. */}
      <div className="mb-8 h-8 w-56 rounded-sm bg-border" />

      {/* Data-table-anchored block: header rule + N rows. */}
      <div className="border border-border bg-surface">
        {/* Header rule. */}
        <div className="flex gap-4 border-b border-border px-4 py-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-2.5 flex-1 rounded-sm bg-border" />
          ))}
        </div>
        {/* Rows. */}
        {Array.from({ length: 8 }).map((_, r) => (
          <div
            key={r}
            className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0"
          >
            {Array.from({ length: 5 }).map((_, c) => (
              <div key={c} className="h-3.5 flex-1 rounded-sm bg-surface-subtle" />
            ))}
          </div>
        ))}
      </div>

      {/* Screen-reader-only liveness hint while the skeleton is up. */}
      <p className="sr-only" role="status" aria-live="polite">
        Loading admin.
      </p>
    </div>
  );
}
