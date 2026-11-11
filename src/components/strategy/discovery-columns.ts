/**
 * Phase 197 plan 01 (CLAR-01, D-05): the ONE label map for the discovery list's columns.
 *
 * Read by the table header (`StrategyTable`) and by the grid card footer (`StrategyGrid`), so the
 * two views of the same list cannot name a column differently. Plain data, no React.
 *
 * Why this is its own module and not beside `COLUMNS` in `StrategyTable.tsx`: `StrategyTable`
 * imports `StrategyGrid`, so the grid importing the map from the table would be an import cycle.
 *
 * What the strings claim (UI-SPEC Interaction contract 1, U-01): the discovery list reads the
 * stored `strategy_analytics` headline scalars, which cover the FULL record (from the last break
 * when the record is chain-broken). So a header says "full record", never "1y". `period` is the
 * lowercase unit text; the table renders it uppercase through its header label class.
 * `annualized` is true for CAGR, Sharpe and volatility, false for the plain returns and the
 * drawdown, and ABSENT for Strategy, Track, AUM and the sparklines: none of those is a rate (U-05).
 */

import { termDefinition, type TermKey } from "@/lib/glossary";

/** Keys of the columns that sort. `track` is a table-only key: it is never a filter-bar `SortKey`. */
export type SortableDiscoveryKey =
  | "name"
  | "track"
  | "cumulative_return"
  | "cagr"
  | "sharpe"
  | "max_drawdown"
  | "volatility"
  | "six_month_return"
  | "aum";

/** Keys of the two sparkline columns, which are plain headers. */
export type PlainDiscoveryKey = "sparkline_returns" | "sparkline_drawdown";

interface DiscoveryColumnBase {
  /** The label line. */
  label: string;
  /** The period unit the figure covers, lowercase ("full record"); absent for Strategy. */
  period?: string;
  /** True annualized, false not annualized, absent when the column is not a rate. */
  annualized?: boolean;
  /** The sort button's accessible name (UI-SPEC "Accessible name" column, verbatim). */
  accessibleName: string;
  /**
   * The registry key this column's label names; absent for Strategy. Phase 201 plan 16 (D-01):
   * the tooltip below is read from the glossary registry through this key, so the discovery
   * header has no second definition source.
   */
  term?: TermKey;
  /** The definition shown on hover or keyboard focus (`termDefinition(term, "discovery")`); absent for Strategy. */
  tooltip?: string;
  align?: "right";
}

export type DiscoveryColumn =
  | (DiscoveryColumnBase & { key: SortableDiscoveryKey; sortable: true })
  | (DiscoveryColumnBase & { key: PlainDiscoveryKey; sortable: false });

/** A column's tooltip, read from the registry (D-01). */
const discoveryTooltip = (key: TermKey): string => termDefinition(key, "discovery");

export const DISCOVERY_COLUMNS: readonly DiscoveryColumn[] = [
  { key: "name", label: "Strategy", accessibleName: "Strategy", sortable: true },
  {
    key: "track",
    label: "Track",
    period: "months of record",
    accessibleName: "Track, months of record",
    term: "track",
    tooltip: discoveryTooltip("track"),
    align: "right",
    sortable: true,
  },
  {
    key: "cumulative_return",
    label: "Return",
    period: "full record",
    annualized: false,
    accessibleName: "Return, full record, not annualized",
    term: "return_full",
    tooltip: discoveryTooltip("return_full"),
    align: "right",
    sortable: true,
  },
  {
    key: "cagr",
    label: "CAGR",
    period: "full record",
    annualized: true,
    accessibleName: "CAGR, full record, annualized",
    term: "cagr",
    tooltip: discoveryTooltip("cagr"),
    align: "right",
    sortable: true,
  },
  {
    key: "sharpe",
    label: "Sharpe",
    period: "full record",
    annualized: true,
    accessibleName: "Sharpe, full record, annualized",
    term: "sharpe",
    tooltip: discoveryTooltip("sharpe"),
    align: "right",
    sortable: true,
  },
  {
    key: "max_drawdown",
    label: "Max DD",
    period: "full record",
    annualized: false,
    accessibleName: "Max DD, full record, not annualized",
    term: "max_drawdown",
    tooltip: discoveryTooltip("max_drawdown"),
    align: "right",
    sortable: true,
  },
  {
    key: "volatility",
    label: "Volatility",
    period: "full record",
    annualized: true,
    accessibleName: "Volatility, full record, annualized",
    term: "volatility",
    tooltip: discoveryTooltip("volatility"),
    align: "right",
    sortable: true,
  },
  {
    key: "six_month_return",
    label: "Return",
    period: "last 6 months",
    annualized: false,
    accessibleName: "Return, last 6 months, not annualized",
    term: "return_6m",
    tooltip: discoveryTooltip("return_6m"),
    align: "right",
    sortable: true,
  },
  {
    key: "aum",
    label: "AUM",
    period: "stated by manager",
    accessibleName: "AUM, stated by manager",
    term: "aum",
    tooltip: discoveryTooltip("aum"),
    align: "right",
    sortable: true,
  },
  {
    key: "sparkline_returns",
    label: "Return curve",
    period: "full record",
    accessibleName: "Return curve, full record",
    term: "return_curve",
    tooltip: discoveryTooltip("return_curve"),
    sortable: false,
  },
  {
    key: "sparkline_drawdown",
    label: "Underwater",
    period: "full record",
    accessibleName: "Underwater, full record",
    term: "underwater",
    tooltip: discoveryTooltip("underwater"),
    sortable: false,
  },
];
