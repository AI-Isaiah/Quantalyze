"use client";

import { SegmentedControl } from "@/components/strategy-v2/SegmentedControl";
import type { RollWindowPick } from "@/lib/factsheet/types";
import type { ChartConfig, ComparatorSeriesKey } from "./chart-configs";

/**
 * 194 D-14 (2026-11-07), additive: the window choice for the factsheet's rolling volatility,
 * Sharpe and Sortino charts. A record of 365 days or more carries a second, 365-calendar-day
 * window beside the row window (`6mo` or `30d`); the row window stays the default and this
 * control adds `1y` as an option, the way Scenario's `365D` is added after `3M` / `6M` / `12M`.
 *
 * A-194-D14-04 (the 1y window REPLACES the row window on the charts) is replaced by this
 * additive reading, in plan 14 and again here: the existing shorter windows keep D-11's rule
 * as superseded by D-15, and the 1y window never becomes the default.
 */

export type RollingChoice = "row" | "1y";

const STRAT_1Y = {
  strategyRollingVol: "strategyRollingVol1y",
  strategyRollingSharpe: "strategyRollingSharpe1y",
  strategyRollingSortino: "strategyRollingSortino1y",
} as const satisfies Partial<Record<NonNullable<ChartConfig["stratField"]>, ChartConfig["stratField"]>>;

const COMPARATOR_1Y = {
  rollingVol: "rollingVol1y",
  rollingSharpe: "rollingSharpe1y",
  rollingSortino: "rollingSortino1y",
} as const satisfies Partial<Record<ComparatorSeriesKey, ComparatorSeriesKey>>;

const WINDOW_LABEL_RE = /\((6mo|30d|90d)\)/i;

export function RollingWindowChoice({
  rowLabel,
  value,
  onChange,
}: {
  /** The row window's own label (`6mo` or `30d`): the default option. */
  rowLabel: string;
  value: RollingChoice;
  onChange: (next: RollingChoice) => void;
}) {
  return (
    <div data-testid="rolling-window-choice">
      <SegmentedControl
        ariaLabel="Rolling window"
        activeId={value}
        onChange={(id) => onChange(id === "1y" ? "1y" : "row")}
        options={[
          { id: "row", label: rowLabel },
          { id: "1y", label: "1y" },
        ]}
      />
    </div>
  );
}

/**
 * The config a rolling chart is drawn from under `choice`. The row choice returns the config
 * unchanged (the caller's row mapping applies). The 1y choice moves the strategy and comparator
 * fields to their `*1y` siblings, titles the chart `(1y)`, and hides the warm-up region before
 * the first full 365 days (`warmup` is the 1y window's first full index, plus one). It adds no
 * note: the 1y window's verdict is full. A config that is not one of the three rolling charts,
 * or a view without a 1y window, is returned unchanged.
 */
export function applyRollingWindowChoice(
  cfg: ChartConfig,
  choice: RollingChoice,
  roll1y: RollWindowPick | null | undefined,
): ChartConfig {
  if (choice !== "1y" || !roll1y) return cfg;
  const strat = cfg.stratField && cfg.stratField in STRAT_1Y
    ? STRAT_1Y[cfg.stratField as keyof typeof STRAT_1Y]
    : null;
  if (!strat) return cfg;
  const comparator = cfg.comparatorField && cfg.comparatorField in COMPARATOR_1Y
    ? COMPARATOR_1Y[cfg.comparatorField as keyof typeof COMPARATOR_1Y]
    : cfg.comparatorField;
  return {
    ...cfg,
    title: cfg.title.replace(WINDOW_LABEL_RE, "(1y)"),
    warmup: roll1y.window,
    stratField: strat,
    comparatorField: comparator,
  };
}
