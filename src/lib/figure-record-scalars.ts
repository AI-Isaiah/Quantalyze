/**
 * Phase 194.1 plan 01 (2026-11-08; 194 D-15 / D-17 / D-20) - the strategy's TOTAL record,
 * built from the four aliased record scalars, with no server-only import.
 *
 * Why it exists: `readRecordSpan` (src/lib/record-span-read.ts) starts with
 * `import "server-only"`, so a client component (the wizard) or an admin client component
 * cannot read the record through it, and several 194.1 sites need the same alias fragment
 * and the same coercion. This is that fragment and that coercion, once.
 *
 * It restates no threshold and no sentence: the verdict is `gateAnnualized` over the record
 * `figureRecord` builds (src/lib/figure-gate.ts), and the crypto / non-crypto basis comes
 * from `annualizationPeriods` (src/lib/closed-sets.ts). The count is the STORED
 * `record_observations`, never a series length.
 *
 * Privacy: the alias list names four scalar JSON-path aliases and never projects
 * `returns_series`, `metrics_json` or `data_quality_flags` whole (194 T-194-19/21/35).
 * `src/lib/figure-record-scalars.test.ts` pins it equal to `RECORD_SPAN_SELECT`'s inner list
 * and to `PERCENTILE_SPAN_COLUMNS` in `queries.ts`.
 */
import { figureRecord, type FigureRecord } from "@/lib/figure-gate";
import { annualizationPeriods } from "@/lib/closed-sets";

// Typed `string` on purpose, NOT a literal: postgrest-js parses a select string at the type
// level and its parser cannot read the `->-1` index of the `series_end` alias, so a literal
// types every row as a `ParserError` (the same reason `PERCENTILE_SPAN_COLUMNS` in
// `queries.ts` is typed `string`). Callers cast the rows they read.
export const RECORD_SCALAR_ALIASES: string =
  "series_start:returns_series->0->>date, series_end:returns_series->-1->>date, headline_since:data_quality_flags->>headline_since, record_observations:metrics_json->record_observations";

/** One `strategy_analytics` row as PostgREST returns it for `RECORD_SCALAR_ALIASES`. */
export type RecordScalarRow = {
  series_start?: unknown;
  series_end?: unknown;
  headline_since?: unknown;
  record_observations?: unknown;
};

// Local twins of `asString` / `asCount` in record-span-read.ts (that module is server-only).
function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The record a strategy's annualised figures are judged on. A null row is a record of
 * unknown span (the gate reads it as `null`); a present but unparsable date is `unreadable`
 * and withheld (D-17, R4 WR-02).
 */
export function recordFromScalars(
  row: RecordScalarRow | null | undefined,
  assetClass: string | null | undefined,
): FigureRecord {
  return figureRecord({
    seriesStart: asString(row?.series_start),
    seriesEnd: asString(row?.series_end),
    headlineSince: asString(row?.headline_since),
    observations: asCount(row?.record_observations),
    periodsPerYear: annualizationPeriods(assetClass),
  });
}
