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

import { SIX_MONTH_WINDOW_DAYS } from "@/lib/factsheet/compute";

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
  /** The definition shown on hover or keyboard focus; absent for Strategy. */
  tooltip?: string;
  align?: "right";
}

export type DiscoveryColumn =
  | (DiscoveryColumnBase & { key: SortableDiscoveryKey; sortable: true })
  | (DiscoveryColumnBase & { key: PlainDiscoveryKey; sortable: false });

/** The UI-SPEC clause every full-record figure's tooltip ends on. */
const FULL_RECORD_BASIS = "From the first return day, or from the last break in the record.";

export const DISCOVERY_COLUMNS: readonly DiscoveryColumn[] = [
  { key: "name", label: "Strategy", accessibleName: "Strategy", sortable: true },
  {
    key: "track",
    label: "Track",
    period: "months of record",
    accessibleName: "Track, months of record",
    tooltip: "How long the record is, in whole months. Counted over the days its returns cover.",
    align: "right",
    sortable: true,
  },
  {
    key: "cumulative_return",
    label: "Return",
    period: "full record",
    annualized: false,
    accessibleName: "Return, full record, not annualized",
    tooltip: `Total return over the whole record. ${FULL_RECORD_BASIS}`,
    align: "right",
    sortable: true,
  },
  {
    key: "cagr",
    label: "CAGR",
    period: "full record",
    annualized: true,
    accessibleName: "CAGR, full record, annualized",
    tooltip: `Compound annual growth rate over the whole record. ${FULL_RECORD_BASIS}`,
    align: "right",
    sortable: true,
  },
  {
    key: "sharpe",
    label: "Sharpe",
    period: "full record",
    annualized: true,
    accessibleName: "Sharpe, full record, annualized",
    tooltip: `Annualized return divided by annualized volatility over the whole record. ${FULL_RECORD_BASIS}`,
    align: "right",
    sortable: true,
  },
  {
    key: "max_drawdown",
    label: "Max DD",
    period: "full record",
    annualized: false,
    accessibleName: "Max DD, full record, not annualized",
    tooltip: `The largest fall from a peak over the whole record. ${FULL_RECORD_BASIS}`,
    align: "right",
    sortable: true,
  },
  {
    key: "volatility",
    label: "Volatility",
    period: "full record",
    annualized: true,
    accessibleName: "Volatility, full record, annualized",
    tooltip: "How much daily returns vary, annualized over the whole record. It is never negative, so it carries no sign.",
    align: "right",
    sortable: true,
  },
  {
    key: "six_month_return",
    label: "Return",
    period: "last 6 months",
    annualized: false,
    accessibleName: "Return, last 6 months, not annualized",
    tooltip: `Return over the ${SIX_MONTH_WINDOW_DAYS} calendar days that end on the record's last day.`,
    align: "right",
    sortable: true,
  },
  {
    key: "aum",
    label: "AUM",
    period: "stated by manager",
    accessibleName: "AUM, stated by manager",
    tooltip: "Assets under management as the manager states it. It is not measured from the exchange.",
    align: "right",
    sortable: true,
  },
  {
    key: "sparkline_returns",
    label: "Return curve",
    period: "full record",
    accessibleName: "Return curve, full record",
    tooltip: "Cumulative return over the whole record.",
    sortable: false,
  },
  {
    key: "sparkline_drawdown",
    label: "Underwater",
    period: "full record",
    accessibleName: "Underwater, full record",
    tooltip: "Distance below the previous peak over the whole record.",
    sortable: false,
  },
];
