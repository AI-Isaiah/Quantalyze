"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * <AlertBanner> — the critical-only, ack-able banner that sits above the
 * peer strip on /allocations. Per docs/notes/alert-routing-v1.md:
 *   - 1 banner max. Extras collapse to "+N more" chip on the right.
 *   - Most recent critical wins; older critical rows become the chip count.
 *   - Never renders non-critical alerts — those belong in <InsightStrip>.
 *
 * Visual contract (alert-routing-v1.md §"Visual spec"):
 *   - Full-width, 56px tall, above the peer strip (not floating).
 *   - bg #FEF2F2, 1px top border #DC2626, no bottom border.
 *   - DM Sans 14px body, color #1A1A2E.
 *   - "Acknowledge" button right-aligned, 24px hit-target, plain text, no icon.
 *   - `hidden md:flex` — mobile polish deferred to Sprint 10.
 *   - No motion, no elevation, no shadow.
 *
 * Data path: GET /api/alerts/critical?portfolio_id=X returns the rows; ack
 * goes through POST /api/alerts/[id]/acknowledge. Both are RLS-enforced
 * under the caller's Supabase session cookie.
 */

interface CriticalAlert {
  id: string;
  portfolio_id: string;
  alert_type: string;
  severity: "critical";
  message: string;
  triggered_at: string;
}

interface AlertBannerProps {
  portfolioId: string;
}

export function AlertBanner({ portfolioId }: AlertBannerProps) {
  const [alerts, setAlerts] = useState<CriticalAlert[]>([]);
  const [acking, setAcking] = useState(false);

  // Fetch critical alerts on mount. If the network flakes we silently
  // render nothing — the banner is not a blocker, and a stale fetch
  // should not surface an error row where there was no critical state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/alerts/critical?portfolio_id=${encodeURIComponent(portfolioId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { alerts?: CriticalAlert[] };
        if (!cancelled) setAlerts(body.alerts ?? []);
      } catch {
        // silent — banner is advisory, not load-blocking
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  const handleAcknowledge = useCallback(async () => {
    if (alerts.length === 0 || acking) return;
    const [head, ...rest] = alerts;
    setAcking(true);

    // Optimistic: drop the head row immediately. If the POST fails we
    // restore it. The banner's idempotent server route makes the
    // restore-on-404 path a near-non-event.
    const previous = alerts;
    setAlerts(rest);
    try {
      const res = await fetch(
        `/api/alerts/${encodeURIComponent(head.id)}/acknowledge`,
        { method: "POST" },
      );
      if (!res.ok && res.status !== 204) {
        setAlerts(previous);
      }
    } catch {
      setAlerts(previous);
    } finally {
      setAcking(false);
    }
  }, [alerts, acking]);

  if (alerts.length === 0) return null;

  const [head, ...rest] = alerts;
  const extra = rest.length;

  return (
    <div
      role="alert"
      aria-live="polite"
      // Visual spec lives in alert-routing-v1.md §"Visual spec".
      // Full-width parent wraps <main>'s max-width; we stretch within
      // AllocationDashboard's container by spilling past the p-6 padding
      // via negative margins so the banner remains flush with the content
      // column without introducing a sibling at the layout root.
      className="hidden md:flex items-center justify-between mb-6 -mx-6 px-6 border-t border-[#DC2626]"
      style={{
        backgroundColor: "#FEF2F2",
        height: "56px",
        fontFamily: "DM Sans, sans-serif",
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <p
          className="truncate text-[14px]"
          style={{ color: "#1A1A2E" }}
        >
          {head.message}
        </p>
        {extra > 0 && (
          <span
            className="shrink-0 rounded px-2 py-0.5 text-[11px] tracking-wider uppercase"
            style={{
              backgroundColor: "#FECACA",
              color: "#1A1A2E",
            }}
          >
            +{extra} more
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={handleAcknowledge}
        disabled={acking}
        className="h-6 min-w-6 text-[#DC2626] hover:underline disabled:opacity-50 disabled:cursor-not-allowed text-[14px]"
        style={{ fontFamily: "DM Sans, sans-serif" }}
      >
        Acknowledge
      </button>
    </div>
  );
}
