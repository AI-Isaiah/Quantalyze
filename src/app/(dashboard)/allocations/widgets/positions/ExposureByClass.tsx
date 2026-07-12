"use client";

import type { ExposureSnapshot, HoldingClass } from "@/lib/portfolio-exposure";
import { Card } from "@/components/ui/Card";
import { formatCurrency } from "@/lib/utils";
import { CHART_ACCENT } from "@/components/charts/chart-tokens";

/**
 * PI-01 — Exposure by asset class (99-UI-SPEC § Widget 1).
 *
 * A segmented horizontal composition bar + KPI strip (GROSS/NET/LONG/SHORT) +
 * per-slice drilldown table — NOT a donut (the class dimension has exactly two
 * values, D-P1, and a single-class book would render a misleading full circle).
 * Pure CSS: no chart library, no data fetching. Consumes a plain `ExposureSnapshot`
 * prop; the data-contract types are imported TYPE-ONLY so the server Supabase
 * client that `@/lib/portfolio-exposure` pulls in never crosses into the client
 * bundle (T-99-01).
 *
 * DESIGN.md lock: long/short DIRECTION is never colored red/green — semantic
 * P&L colors stay reserved for gains/losses. NET carries its sign in the number
 * plus a muted "net long / net short / flat" caption instead.
 */

// Neutral navy for the derivative segment (99-UI-SPEC § Color). Deliberately a
// LOCAL const — src/components/charts/** is the design-lint-exempt frozen glob,
// so this non-semantic categorical color must NOT be added to chart-tokens.ts.
const DERIVATIVE_COLOR = "#0F172A";

const CLASS_ORDER: HoldingClass[] = ["spot", "derivative"];
const CLASS_LABEL: Record<HoldingClass, string> = {
  spot: "Spot",
  derivative: "Derivatives",
};
// Compact class label for the dense drilldown table (99-UI-SPEC § Widget 1 · 4).
const CLASS_LABEL_SHORT: Record<HoldingClass, string> = {
  spot: "Spot",
  derivative: "Deriv",
};
const CLASS_COLOR: Record<HoldingClass, string> = {
  spot: CHART_ACCENT,
  derivative: DERIVATIVE_COLOR,
};

export function ExposureByClass({ snapshot }: { snapshot: ExposureSnapshot | null }) {
  // Honest-empty (snapshot === null → zero holdings OR >730d stale, W4). The
  // AttributionBar empty-card idiom, verbatim. A read ERROR is NOT an empty
  // state — it propagates to allocations/error.tsx; the widget only renders the
  // data it is given.
  if (snapshot === null) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-small text-text-muted">No position snapshot yet.</p>
        <p className="text-caption text-text-muted">
          Exposure appears after your first exchange sync. Snapshots older than 24 months are not shown.
        </p>
      </div>
    );
  }

  const gross = snapshot.totalGrossUsd;
  const net = snapshot.totalNetUsd;
  // D-P2 signed math, derived from the slices (no invented data): LONG is the
  // sum of positive signed values, SHORT the magnitude of the negative ones.
  const long = snapshot.slices.reduce((a, s) => (s.signedValueUsd > 0 ? a + s.signedValueUsd : a), 0);
  const short = snapshot.slices.reduce((a, s) => (s.signedValueUsd < 0 ? a - s.signedValueUsd : a), 0);
  const netCaption = net > 0 ? "net long" : net < 0 ? "net short" : "flat";

  const classGross: Record<HoldingClass, number> = { spot: 0, derivative: 0 };
  for (const s of snapshot.slices) classGross[s.holdingType] += s.valueUsd;
  const sharePct = (cls: HoldingClass) => (gross > 0 ? (classGross[cls] / gross) * 100 : 0);
  const present = CLASS_ORDER.filter((cls) => classGross[cls] > 0);

  return (
    <Card padding="sm">
      <div className="flex items-center justify-between">
        <h4 className="text-small font-semibold text-text-primary">Exposure by asset class</h4>
        <span className="text-caption font-metric text-text-muted">as of {snapshot.asof}</span>
      </div>

      {/* KPI strip — GROSS / NET / LONG / SHORT. No color on direction. */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCell testid="kpi-gross" label="Gross" value={gross} />
        <div>
          <p className="text-micro uppercase tracking-wider text-text-muted">Net</p>
          <p data-testid="kpi-net" className="text-h3 font-semibold font-metric text-text-primary">
            {formatCurrency(net)}
          </p>
          <p data-testid="net-caption" className="text-caption text-text-muted">
            {netCaption}
          </p>
        </div>
        <KpiCell testid="kpi-long" label="Long" value={long} />
        <KpiCell testid="kpi-short" label="Short" value={short} />
      </div>

      {/* Composition bar — one segment per PRESENT class, share of gross. */}
      <div
        role="img"
        aria-label={`Gross exposure split: Spot ${sharePct("spot").toFixed(1)}%, Derivatives ${sharePct("derivative").toFixed(1)}%`}
        className="mt-4 flex h-3 w-full overflow-hidden rounded-sm bg-track"
      >
        {present.map((cls, i) => (
          <div
            key={cls}
            data-testid={`exposure-segment-${cls}`}
            className={i > 0 ? "border-l border-white" : undefined}
            style={{ width: `${sharePct(cls)}%`, backgroundColor: CLASS_COLOR[cls] }}
          />
        ))}
      </div>

      {/* Legend — ALWAYS both classes; an absent class reads "· —" (muted). */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {CLASS_ORDER.map((cls) => {
          const isPresent = classGross[cls] > 0;
          const valueStr = isPresent
            ? `${formatCurrency(classGross[cls])} (${sharePct(cls).toFixed(1)}%)`
            : "—";
          return (
            <div
              key={cls}
              data-testid={`legend-${cls}`}
              className={`flex items-center gap-1 ${isPresent ? "" : "text-text-muted"}`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: CLASS_COLOR[cls] }}
              />
              <span className="text-small">{CLASS_LABEL[cls]}</span>
              <span className="text-small font-metric">{` · ${valueStr}`}</span>
            </div>
          );
        })}
      </div>

      {/* Drilldown table — per (venue, symbol, type, side) slice, valueUsd desc.
          Table idiom copied from CompositionDonut. Class identity is carried by
          label + swatch, never color alone (WCAG 1.4.1). Side/Net never colored
          by direction. Scrolls only past 12 rows. */}
      <div
        data-testid="drilldown"
        className={`mt-4 overflow-x-auto ${snapshot.slices.length > 12 ? "max-h-64 overflow-y-auto" : ""}`}
      >
        <table className="w-full text-small">
          <thead>
            <tr className="border-b border-border text-left text-caption text-text-muted uppercase tracking-wider">
              <th className="py-2 pr-4">Venue</th>
              <th className="py-2 pr-4">Symbol</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Side</th>
              <th className="py-2 pr-4 text-right font-metric">Gross</th>
              <th className="py-2 text-right font-metric">Net</th>
            </tr>
          </thead>
          <tbody>
            {[...snapshot.slices]
              .sort((a, b) => b.valueUsd - a.valueUsd)
              .map((s) => (
                <tr
                  key={`${s.holdingType}|${s.venue}|${s.symbol}|${s.side}`}
                  className="border-b border-border/50 transition-colors hover:bg-page/50"
                >
                  <td className="py-2 pr-4">{s.venue}</td>
                  <td className="py-2 pr-4">{s.symbol}</td>
                  <td className="py-2 pr-4">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ backgroundColor: CLASS_COLOR[s.holdingType] }}
                      />
                      {CLASS_LABEL_SHORT[s.holdingType]}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-caption text-text-secondary">{s.side}</td>
                  <td className="py-2 pr-4 text-right font-metric">{formatCurrency(s.valueUsd)}</td>
                  <td className="py-2 text-right font-metric">{formatCurrency(s.signedValueUsd)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function KpiCell({ testid, label, value }: { testid: string; label: string; value: number }) {
  return (
    <div>
      <p className="text-micro uppercase tracking-wider text-text-muted">{label}</p>
      <p data-testid={testid} className="text-h3 font-semibold font-metric text-text-primary">
        {formatCurrency(value)}
      </p>
    </div>
  );
}
