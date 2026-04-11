import { Sparkline } from "@/components/charts/Sparkline";

/**
 * Shared factsheet metric/sparkline preview. Renders the same hero-metric
 * layout from either real analytics or seeded demo data.
 *
 * Design choices:
 *   - Takes a `metrics` array of preformatted strings, NOT a full
 *     StrategyAnalytics row. The caller formats numbers itself; this
 *     decouples the component from the analytics schema so demo seeds
 *     don't need to fake the row shape.
 *   - Renders 6 metrics as a single shared-axis row with hairline
 *     dividers, NOT as 3x2 rounded cards. The grid form is an
 *     institutional-report anti-pattern per DESIGN.md.
 *   - Sparkline is optional — we never render placeholder boxes.
 *   - `sampleLabel` is opt-in so a real preview can't accidentally
 *     render a demo badge.
 */
export interface FactsheetPreviewMetric {
  label: string;
  /** Preformatted value string (e.g., "+24.3%", "1.82", "—"). */
  value: string;
  /** Optional qualitative suffix (e.g., "Strong", "Modest"). */
  qualifier?: string;
}

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
}

export function FactsheetPreview({
  strategyName,
  subtitle,
  metrics,
  sparklineReturns,
  computedAt,
  sampleLabel,
}: FactsheetPreviewProps) {
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
          <p className="text-[11px] font-semibold text-accent">Verified by Quantalyze</p>
          {computedAt && (
            <p className="text-[10px] text-text-muted">
              Data verified from exchange API · {new Date(computedAt).toLocaleDateString()}
            </p>
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
