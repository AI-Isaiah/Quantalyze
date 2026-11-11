"use client";

import Link from "next/link";
import { formatPercent, formatNumber, cn } from "@/lib/utils";
import { getMetricLabel, LABEL_COLORS } from "@/lib/metric-labels";
import { Term } from "@/components/ui/Term";
import type { TermKey } from "@/lib/glossary";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import {
  ANNUALIZED_KEYS,
  SHORT_TRACK_MARKER,
  gateAnnualized,
  gatedValue,
  shortTrackMarkerTitle,
  withheldCellTitle,
  type FigureRecord,
  type FigureState,
} from "@/lib/figure-gate";
import type { HoldingCompareItem } from "@/app/(dashboard)/compare/lib/holding-compare-adapter";
import { HoldingFactsheet } from "./HoldingFactsheet";

interface StrategyItem {
  kind: "strategy";
  strategy: Strategy;
  analytics: StrategyAnalytics;
  /**
   * 194 D-15: the strategy's TOTAL record (span, stored observation count, crypto), built
   * SERVER-SIDE by compare/page.tsx. The table never sees `headline_since`, the count
   * alias or a series, only these three scalars.
   */
  figureRecord: FigureRecord;
}

// Phase 09 / finding g4: discriminated union so CompareTable can render
// both strategy columns and holding-side factsheet panels.
type CompareItem = StrategyItem | HoldingCompareItem;

interface MetricRow {
  label: string;
  key: string;
  format: "percent" | "percentUnsigned" | "number" | "days";
  higherIsBetter: boolean;
  qualKey?: string;
  /** The registry key this row's label names (D-02); the label renders as a `Term`. */
  term?: TermKey;
}

const METRICS: MetricRow[] = [
  { label: "Cumulative Return", key: "cumulative_return", format: "percent", higherIsBetter: true },
  { label: "CAGR", key: "cagr", format: "percent", higherIsBetter: true, qualKey: "cagr", term: "cagr" },
  { label: "Sharpe", key: "sharpe", format: "number", higherIsBetter: true, qualKey: "sharpe", term: "sharpe" },
  { label: "Sortino", key: "sortino", format: "number", higherIsBetter: true, qualKey: "sortino", term: "sortino" },
  { label: "Calmar", key: "calmar", format: "number", higherIsBetter: true, qualKey: "calmar", term: "calmar" },
  { label: "Max Drawdown", key: "max_drawdown", format: "percent", higherIsBetter: true, qualKey: "max_drawdown", term: "max_drawdown" },
  { label: "DD Duration", key: "max_drawdown_duration_days", format: "days", higherIsBetter: false, term: "dd_duration" },
  { label: "Volatility", key: "volatility", format: "percentUnsigned", higherIsBetter: false, qualKey: "volatility", term: "volatility" },
  { label: "6 Month Return", key: "six_month_return", format: "percent", higherIsBetter: true },
];

function getValue(analytics: StrategyAnalytics, key: string): number | null {
  const val = (analytics as unknown as Record<string, unknown>)[key];
  return typeof val === "number" ? val : null;
}

// 194 D-04 as superseded by D-15: CAGR, Sharpe, Sortino, Calmar and Volatility go through
// the total-record gate. A withheld value is null here, so it prints `—`, carries no
// qualitative chip and can never be the column's best.
const ANNUALIZED = new Set<string>(ANNUALIZED_KEYS);

function cellValue(item: StrategyItem, key: string, state: FigureState): number | null {
  const val = getValue(item.analytics, key);
  return ANNUALIZED.has(key) ? gatedValue(val, state) : val;
}

function formatValue(value: number | null, format: MetricRow["format"]): string {
  if (value == null) return "—";
  if (format === "percent") return formatPercent(value);
  // Phase 201 D-15/D-25: volatility is never negative, so a plus sign says nothing. Unsigned,
  // the same as the discovery table and the tearsheet print it.
  if (format === "percentUnsigned") return formatPercent(value, 2, { signed: false });
  if (format === "days") return `${value}d`;
  return formatNumber(value);
}

function findWinner(
  items: StrategyItem[],
  states: FigureState[],
  key: string,
  higherIsBetter: boolean,
): number | null {
  let bestIdx: number | null = null;
  let bestVal: number | null = null;
  items.forEach((item, i) => {
    const val = cellValue(item, key, states[i]);
    if (val == null) return;
    if (bestVal == null || (higherIsBetter ? val > bestVal : val < bestVal)) {
      bestVal = val;
      bestIdx = i;
    }
  });
  return bestIdx;
}

export function CompareTable({
  items,
  removeHrefs,
}: {
  items: CompareItem[];
  /**
   * Phase 197 (D-04, U-10): strategy id to the comparison URL without it. When an
   * entry exists the column header gets a Remove link; absent, the header is
   * unchanged. Holding panels never get one.
   */
  removeHrefs?: Record<string, string>;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-text-muted text-center py-8">Select strategies to compare.</p>;
  }

  // Phase 09 / finding g4: separate holding items (full-width factsheet card) from
  // strategy items (tabular comparison columns).
  const holdingItems = items.filter((item): item is HoldingCompareItem => item.kind === "holding");
  const strategyItems = items.filter((item): item is StrategyItem => item.kind === "strategy");
  // One verdict per strategy column, from its total record (D-15).
  const states = strategyItems.map((item) => gateAnnualized(item.figureRecord));

  return (
    <div className="space-y-6">
      {/* Holding-side factsheet panels — rendered first, full-width, per finding g4 */}
      {holdingItems.map((item) => (
        <HoldingFactsheet key={item.holding_ref} item={item} />
      ))}

      {/* Strategy comparison table. 52-03 / TYPE-04: the overflow wrapper is the
          `@container` containment context (mirrors the ResponsiveTable +
          StrategyTable idiom). Column behavior reacts to the TABLE's own measure
          via `@`-prefixed variants, never a viewport `lg:` — so at the wider
          fluid-fill canvas (fully fluid since 2026-08-09; no px cap) the comparison columns
          gain deliberate horizontal breathing room (`@3xl:px-8`) rather than
          stranding two columns in whitespace (Pitfall 4). Plain `@container`,
          never `@container-size` (Pitfall 1). */}
      {strategyItems.length > 0 && (
        <div className="@container overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 @3xl:px-8 py-3 text-xs font-semibold text-text-muted w-40">Metric</th>
                {strategyItems.map((item) => (
                  // TYPE-02 tabular treatment: single-line name + title={name} so
                  // the full strategy name recovers on hover in this dense
                  // tabular-aligned context (audit treatment (b)). Never a
                  // fabricated placeholder — the real name renders.
                  <th
                    key={item.strategy.id}
                    title={item.strategy.name}
                    className="text-right px-4 @3xl:px-8 py-3 text-xs font-semibold text-text-primary whitespace-nowrap"
                  >
                    {removeHrefs?.[item.strategy.id] ? (
                      <>
                        <span className="block">{item.strategy.name}</span>
                        <Link
                          href={removeHrefs[item.strategy.id]}
                          aria-label={`Remove ${item.strategy.name} from the comparison`}
                          className="text-caption font-normal text-text-muted underline hover:text-text-primary"
                        >
                          Remove
                        </Link>
                      </>
                    ) : (
                      item.strategy.name
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => {
                const winnerIdx = findWinner(strategyItems, states, metric.key, metric.higherIsBetter);
                const gated = ANNUALIZED.has(metric.key);
                return (
                  <tr key={metric.key} className="border-b border-border/50 hover:bg-page/50">
                    <td className="px-4 @3xl:px-8 py-2.5 text-xs text-text-muted">{metric.term ? <Term k={metric.term}>{metric.label}</Term> : metric.label}</td>
                    {strategyItems.map((item, i) => {
                      const val = cellValue(item, metric.key, states[i]);
                      const record = item.figureRecord;
                      const withheld = gated && states[i] === "withheld";
                      const shortSpan =
                        gated && states[i] === "short" && record.spanDays != null ? record.spanDays : null;
                      const isWinner = winnerIdx === i && strategyItems.length > 1;
                      const qual = metric.qualKey ? getMetricLabel(metric.qualKey, val) : null;
                      return (
                        <td key={item.strategy.id} className="text-right px-4 @3xl:px-8 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            {qual && (
                              // DS-04 / 52-UI-SPEC badge exception: the qual chip
                              // uses the --text-micro tier (10→11px), permitted
                              // ONLY for badge text. Migrated off the prior raw
                              // font-px literal onto the named tier.
                              <span className={cn("rounded px-1.5 py-0.5 text-micro font-medium", LABEL_COLORS[qual.color])}>
                                {qual.label}
                              </span>
                            )}
                            {/* TYPE-04: tabular-nums on every numeric value so the
                                comparison columns stay digit-aligned under the
                                fluid type spine and across the @container reflow. */}
                            <span
                              title={withheld ? withheldCellTitle(record) : undefined}
                              className={cn(
                                "text-xs font-metric tabular-nums",
                                isWinner ? "text-accent font-semibold" : "text-text-secondary",
                              )}
                            >
                              {formatValue(val, metric.format)}
                              {withheld && <span className="sr-only">{withheldCellTitle(record)}</span>}
                              {shortSpan != null && (
                                <span
                                  title={shortTrackMarkerTitle(shortSpan)}
                                  className="ml-1 inline-block min-w-[3ch] text-right align-baseline text-micro font-mono tabular-nums text-text-muted"
                                >
                                  {SHORT_TRACK_MARKER}
                                  <span className="sr-only"> {shortTrackMarkerTitle(shortSpan)}</span>
                                </span>
                              )}
                              {/* Winner mark: a discrete DM Sans accent glyph
                                  (own span, own spacing) — NOT a " ✓" string
                                  concatenated into the mono numeric run. Drops
                                  the banned third weight (font-bold) too. */}
                              {isWinner && <span className="ml-1 font-sans">✓</span>}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
