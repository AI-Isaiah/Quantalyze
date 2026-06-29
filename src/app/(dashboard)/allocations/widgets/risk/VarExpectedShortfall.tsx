"use client";

import { useMemo } from "react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildCompositeReturns } from "../lib/composite-returns";
import { computeVaR, computeExpectedShortfall } from "@/lib/portfolio-stats";
import { withWidgetBoundary, type BaseWidgetProps } from "../lib/widget-boundary";
import { riskWidgetDataSchema, type RiskWidgetData } from "../lib/widget-data";
import { formatPercent } from "@/lib/utils";

// ---------------------------------------------------------------------------
// VaR & Expected Shortfall Widget
//
// Computes Value at Risk (95%, 99%) and Expected Shortfall (CVaR 95%)
// from portfolio composite weighted daily returns. Renders three large
// numbers with labels and a horizontal bar with green/yellow/red risk zones.
// ---------------------------------------------------------------------------

/** Map a VaR value to a zone for the bar indicator. */
function riskZone(var95: number): "green" | "yellow" | "red" {
  const absVar = Math.abs(var95);
  if (absVar < 0.02) return "green";
  if (absVar < 0.05) return "yellow";
  return "red";
}

const ZONE_COLORS = {
  green: "#15803D",
  yellow: "#CA8A04",
  red: "#DC2626",
} as const;

function VarExpectedShortfallInner({ data }: { data: RiskWidgetData } & BaseWidgetProps) {
  const { var95, var99, es95, zone } = useMemo(() => {
    // Use weighted composite returns instead of unweighted concatenation
    const composite: DailyPoint[] = data.compositeReturns ?? buildCompositeReturns(data.strategies);
    const allReturns = composite.map((d) => d.value);

    if (allReturns.length < 10) {
      return { var95: 0, var99: 0, es95: 0, zone: "green" as const };
    }

    const v95 = computeVaR(allReturns, 0.95);
    const v99 = computeVaR(allReturns, 0.99);
    const e95 = computeExpectedShortfall(allReturns, 0.95);

    return { var95: v95, var99: v99, es95: e95, zone: riskZone(v95) };
  }, [data]);

  if (var95 === 0 && var99 === 0 && es95 === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "#64748B" }}
      >
        Insufficient return data for VaR calculation
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col justify-between gap-4"
      data-testid="var-expected-shortfall"
    >
      {/* Three metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div
            className="font-metric text-xl tabular-nums"
            style={{ color: "#DC2626" }}
          >
            {formatPercent(var95)}
          </div>
          <div
            className="mt-1 font-sans text-fixed-11 font-medium uppercase tracking-wider"
            style={{ color: "#64748B" }}
          >
            VaR 95%
          </div>
        </div>
        <div className="text-center">
          <div
            className="font-metric text-xl tabular-nums"
            style={{ color: "#DC2626" }}
          >
            {formatPercent(var99)}
          </div>
          <div
            className="mt-1 font-sans text-fixed-11 font-medium uppercase tracking-wider"
            style={{ color: "#64748B" }}
          >
            VaR 99%
          </div>
        </div>
        <div className="text-center">
          <div
            className="font-metric text-xl tabular-nums"
            style={{ color: "#DC2626" }}
          >
            {formatPercent(es95)}
          </div>
          <div
            className="mt-1 font-sans text-fixed-11 font-medium uppercase tracking-wider"
            style={{ color: "#64748B" }}
          >
            CVaR 95%
          </div>
        </div>
      </div>

      {/* Risk zone bar */}
      <div className="px-1">
        <div className="flex gap-0.5 overflow-hidden rounded" style={{ height: 8 }}>
          <div className="flex-1" style={{ backgroundColor: "#15803D" }} />
          <div className="flex-1" style={{ backgroundColor: "#CA8A04" }} />
          <div className="flex-1" style={{ backgroundColor: "#DC2626" }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="font-sans text-fixed-10" style={{ color: "#64748B" }}>
            Low risk
          </span>
          <span
            className="rounded px-2 py-0.5 font-sans text-fixed-10 font-semibold uppercase"
            style={{
              color: ZONE_COLORS[zone],
              backgroundColor: `${ZONE_COLORS[zone]}14`,
            }}
          >
            {zone}
          </span>
          <span className="font-sans text-fixed-10" style={{ color: "#64748B" }}>
            High risk
          </span>
        </div>
      </div>
    </div>
  );
}

// B21: validate `data` against the shared risk-widget contract + contain throws.
export const VarExpectedShortfall = withWidgetBoundary(
  riskWidgetDataSchema,
  VarExpectedShortfallInner,
  { area: "var-expected-shortfall" },
);
