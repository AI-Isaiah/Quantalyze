"use client";

import { useEffect, useState, useCallback } from "react";

// Critical-only ack-able banner. Spec: docs/notes/alert-routing-v1.md.

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
  // True when the most recent fetch returned 5xx — we render a small
  // inline hint so the user knows the critical-alert check failed.
  // 4xx and network errors don't surface (advisory banner; we still
  // log to console.error for debugging).
  const [fetchFailed, setFetchFailed] = useState(false);

  // Fetch critical alerts on mount. Failures are logged to console.error
  // so they're visible in browser devtools / Sentry breadcrumbs; only
  // 5xx responses surface a UI hint (the banner is advisory and we'd
  // rather under-disclose than show error chrome on transient 4xx).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/alerts/critical?portfolio_id=${encodeURIComponent(portfolioId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          console.error(
            "[AlertBanner] critical-alert fetch failed",
            { portfolioId, status: res.status },
          );
          if (!cancelled && res.status >= 500) setFetchFailed(true);
          return;
        }
        const body = (await res.json()) as { alerts?: CriticalAlert[] };
        if (!cancelled) {
          setAlerts(body.alerts ?? []);
          setFetchFailed(false);
        }
      } catch (err) {
        console.error(
          "[AlertBanner] critical-alert fetch threw",
          { portfolioId, err },
        );
        // Network error — treat as transient, no UI hint.
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

  if (alerts.length === 0) {
    if (!fetchFailed) return null;
    // 5xx fetch failure with no known critical state — show a quiet
    // inline hint so the user knows the check itself failed (rather than
    // assuming "no critical alerts").
    return (
      <p
        className="hidden md:block mb-2 text-caption text-text-muted"
        role="status"
      >
        Couldn&apos;t verify critical alerts.
      </p>
    );
  }

  const [head, ...rest] = alerts;
  const extra = rest.length;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="hidden md:flex items-center justify-between mb-6 px-6 border-t border-negative bg-[#FEF2F2]"
      style={{ height: "56px" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* TYPE-02 (truncation-audit AlertBanner:127) — the critical-alert
            message is meaningful prose; wrap it (`break-words min-w-0`) so the
            text is never silently single-line-clipped. The +N overflow chip
            stays a fixed-size affordance to its right. */}
        <p className="break-words min-w-0 text-body text-text-primary">
          {head.message}
        </p>
        {extra > 0 && (
          <span className="shrink-0 rounded bg-[#FECACA] px-2 py-0.5 text-micro tracking-wider uppercase text-text-primary">
            +{extra} more
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={handleAcknowledge}
        disabled={acking}
        className="h-6 min-w-6 text-negative hover:underline disabled:opacity-50 disabled:cursor-not-allowed text-body"
      >
        Acknowledge
      </button>
    </div>
  );
}
