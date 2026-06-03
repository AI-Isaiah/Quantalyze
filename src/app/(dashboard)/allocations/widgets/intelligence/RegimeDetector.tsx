"use client";

import { useMemo } from "react";
import { detectRegimeChanges } from "@/lib/portfolio-stats";
import { buildCompositeReturns } from "../lib/composite-returns";
import { withWidgetBoundary, type BaseWidgetProps } from "../lib/widget-boundary";
import { riskWidgetDataSchema, type RiskWidgetData } from "../lib/widget-data";

const REGIME_CONFIG = {
  bullish: { label: "Bull Market", color: "#15803D", bg: "rgba(21,128,61,0.08)" },
  bearish: { label: "Bear Market", color: "#DC2626", bg: "rgba(220,38,38,0.08)" },
  neutral: { label: "Range-bound", color: "#D97706", bg: "rgba(217,119,6,0.08)" },
} as const;

function daysBetween(a: string, b: string): number {
  return Math.floor(
    (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000,
  );
}

function RegimeDetectorInner({ data }: { data: RiskWidgetData } & BaseWidgetProps) {
  const regime = useMemo(() => {
    // M-0174: the regime LABEL must reflect the allocator's actual
    // WEIGHTED portfolio, not an equal-weight average of every strategy.
    // The prior inline `sum/count` mean ignored current_weight, so one
    // 90%-weight winner among nine 1%-weight losers showed the losers'
    // regime. Use the shared weighted composite (date-keyed, per-date
    // renormalized — F2 H-0158) like the sibling risk widgets
    // (TailRisk / VarExpectedShortfall / RiskDecomposition).
    const composite =
      data.compositeReturns ?? buildCompositeReturns(data.strategies);

    if (composite.length < 200) return null;

    const crossovers = detectRegimeChanges(composite);

    if (crossovers.length === 0) {
      // No crossovers: determine direction from MA relationship
      return {
        direction: "neutral" as const,
        startDate: composite[199].date,
        endDate: composite[composite.length - 1].date,
      };
    }

    const last = crossovers[crossovers.length - 1];
    return {
      direction: last.direction,
      startDate: last.date,
      endDate: composite[composite.length - 1].date,
    };
  }, [data.strategies, data.compositeReturns]);

  if (!regime) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm" style={{ color: "#64748B" }}>
          Insufficient data for regime detection (need 200+ days)
        </span>
      </div>
    );
  }

  const cfg =
    regime.direction === "bullish"
      ? REGIME_CONFIG.bullish
      : regime.direction === "bearish"
        ? REGIME_CONFIG.bearish
        : REGIME_CONFIG.neutral;

  const duration = daysBetween(regime.startDate, regime.endDate);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div
        className="rounded-lg px-6 py-3 text-center"
        style={{ backgroundColor: cfg.bg }}
      >
        <span
          className="text-xl font-semibold"
          style={{ color: cfg.color }}
        >
          {cfg.label}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs" style={{ color: "#64748B" }}>
        <span>
          Since{" "}
          <span className="font-mono tabular-nums">
            {new Date(regime.startDate + "T00:00:00Z").toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric", year: "numeric" },
            )}
          </span>
        </span>
        <span className="text-[#E2E8F0]">|</span>
        <span>
          <span className="font-mono tabular-nums">{duration}</span> days
        </span>
      </div>
    </div>
  );
}

// B21: validate `data` against the shared risk-widget contract + contain throws.
export const RegimeDetector = withWidgetBoundary(
  riskWidgetDataSchema,
  RegimeDetectorInner,
  { area: "regime-detector" },
);
