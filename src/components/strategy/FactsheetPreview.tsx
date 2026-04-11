import { Sparkline } from "@/components/charts/Sparkline";

/**
 * Shared factsheet hero-metric panel. Takes preformatted strings so
 * demo seeds and real analytics can share the same component without
 * the demo side having to fake the full StrategyAnalytics shape.
 * Renders 6 metrics in a single shared-axis row (DESIGN.md anti-pattern
 * against 3x2 rounded cards).
 *
 * `verificationState` controls the header badge:
 *   - "verified" (default): "Verified by Quantalyze" in accent. Used
 *     on /for-quants (seeded) and /factsheet/[id] (approved).
 *   - "pending": "Submitted for review" in muted text. Used after
 *     wizard SubmitStep fires finalize.
 *   - "draft": "Draft preview · pending review" in muted text. Used
 *     inside the wizard SyncPreviewStep before admin review.
 */
export interface FactsheetPreviewMetric {
  label: string;
  /** Preformatted value string (e.g., "+24.3%", "1.82", "—"). */
  value: string;
  /** Optional qualitative suffix (e.g., "Strong", "Modest"). */
  qualifier?: string;
}

export type FactsheetVerificationState = "draft" | "pending" | "verified";

export interface FactsheetPreviewProps {
  /** Strategy display name — shown in the header. Pass the codename for exploratory-tier. */
  strategyName: string;
  /** Strategy types + markets blurb, e.g. "SMA crossover · BTC, ETH". */
  subtitle?: string;
  /** Six metric tiles in a single row. The design system expects exactly six. */
  metrics: FactsheetPreviewMetric[];
  /** Raw return series for the equity sparkline. Omit to hide the sparkline. */
  sparklineReturns?: number[] | null;
  /** ISO timestamp shown as "computed" metadata. */
  computedAt?: string | null;
  /** When true, renders a "Sample Strategy (Demo Data)" caption below the panel. */
  sampleLabel?: string;
  /**
   * Trust/verification state shown in the header badge. Defaults to
   * "verified" so existing /for-quants and /factsheet/[id] callers
   * render unchanged. Wizard SyncPreviewStep passes "draft".
   */
  verificationState?: FactsheetVerificationState;
}

interface VerificationBadgeStyle {
  headline: string;
  caption: string;
  className: string;
}

function resolveBadge(
  state: FactsheetVerificationState,
  computedAt: string | null | undefined,
): VerificationBadgeStyle {
  const dateLabel = computedAt
    ? `Data from exchange API · ${new Date(computedAt).toLocaleDateString()}`
    : null;

  if (state === "draft") {
    return {
      headline: "Draft preview · pending review",
      caption:
        dateLabel ?? "Computed from your exchange trades — not yet admin-reviewed",
      className: "text-text-muted",
    };
  }

  if (state === "pending") {
    return {
      headline: "Submitted for review",
      caption: dateLabel ?? "Awaiting founder approval",
      className: "text-text-muted",
    };
  }

  // "verified" — the historic default. Preserves /for-quants exactly.
  return {
    headline: "Verified by Quantalyze",
    caption: dateLabel ?? "",
    className: "text-accent",
  };
}

export function FactsheetPreview({
  strategyName,
  subtitle,
  metrics,
  sparklineReturns,
  computedAt,
  sampleLabel,
  verificationState = "verified",
}: FactsheetPreviewProps) {
  const badge = resolveBadge(verificationState, computedAt ?? null);

  return (
    <div className="rounded-lg border border-border bg-white">
      {/* Header: name + subtitle + verified badge */}
      <div className="flex items-start justify-between border-b border-border px-6 py-4">
        <div>
          <h3 className="font-display text-lg text-text-primary">{strategyName}</h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>
          )}
        </div>
        <div className="text-right">
          <p
            className={`text-[11px] font-semibold ${badge.className}`}
            data-testid="factsheet-verification-badge"
            data-verification-state={verificationState}
          >
            {badge.headline}
          </p>
          {badge.caption && (
            <p className="text-[10px] text-text-muted">{badge.caption}</p>
          )}
        </div>
      </div>

      {/* Metrics: single shared-axis row, hairline column dividers */}
      <div className="grid grid-cols-2 divide-x divide-border md:grid-cols-6">
        {metrics.map((m) => (
          <div key={m.label} className="px-4 py-4">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">
              {m.label}
            </p>
            <p className="mt-1 font-metric text-lg font-semibold text-text-primary">
              {m.value}
            </p>
            {m.qualifier && (
              <p className="mt-0.5 text-[10px] text-text-muted">{m.qualifier}</p>
            )}
          </div>
        ))}
      </div>

      {/* Equity sparkline — full-width under the metric row */}
      {sparklineReturns && sparklineReturns.length > 1 && (
        <div className="border-t border-border px-6 py-4">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-text-muted">
            Equity Curve
          </p>
          <Sparkline
            data={sparklineReturns}
            width={720}
            height={64}
            color="#1B6B5A"
            className="w-full"
          />
        </div>
      )}

      {/* Sample-data caption */}
      {sampleLabel && (
        <div className="border-t border-border bg-page px-6 py-3">
          <p className="text-xs text-text-muted">{sampleLabel}</p>
        </div>
      )}
    </div>
  );
}
