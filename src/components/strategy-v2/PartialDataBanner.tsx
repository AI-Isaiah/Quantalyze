interface PartialDataBannerProps {
  heading: string;
  body: string;
}

/**
 * Phase 14a / KPI-23a — shared partial-data banner for Panels 1–3.
 *
 * Server component (no `"use client"`). Renders inside the body region of a
 * panel card when the strategy's `history_days` falls below the panel's
 * threshold (see UI-SPEC §4). The panel heading + outer card chrome remain
 * unchanged — the banner replaces only the body region.
 */
export function PartialDataBanner({ heading, body }: PartialDataBannerProps) {
  return (
    <div className="mx-auto max-w-[480px] rounded-md border border-border bg-surface-subtle p-4 text-center">
      <p className="text-xs font-normal uppercase tracking-wider text-text-secondary">
        {heading}
      </p>
      <p className="mt-1 text-xs font-normal text-text-muted">{body}</p>
    </div>
  );
}
