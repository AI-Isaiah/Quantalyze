/**
 * 194.1 plan 09 (census B8, 194 D-04 as superseded by D-15, 2026-11-08) — the Scenario composer's
 * per-constituent figure verdict.
 *
 * An added strategy's detail row prints that strategy's own stored CAGR and Sharpe. Those are
 * annualised figures, so they are judged on THAT strategy's own TOTAL record, never on the blend's.
 * A book leg reads the three record scalars `getMyAllocationDashboard` already ships
 * (`figure_span_days`, `figure_observations`, `figure_crypto`); a drawer-added leg reads the same
 * three names, served by `GET /api/strategies/[id]/returns`.
 *
 * Why this lives outside `ScenarioComposer.tsx`: the composer is shared with phases 196, 197 and 198
 * running in parallel, so every piece of logic is here and the composer carries only one-line
 * hooks into it. No JSX here: the cell is built by `annualizedCell`.
 *
 * The scalars are coerced exactly as `gatedSharpe` (strategies-row-adapter.ts) coerces them: an
 * absent or malformed one is an UNKNOWN record (state "null": the stored figure shown as today, no
 * marker), never a number the strategy does not have.
 */
import type { ReactNode } from "react";
import { gateAnnualized, gatedValue, type FigureRecord, type FigureState } from "@/lib/figure-gate";
import { annualizedCell } from "@/components/strategy/annualized-cell";

/**
 * A settled lazy-fetch entry: the stored pair, plus the record the route served beside it.
 * `record` is optional so a settled pair built before this plan, or by a test, is an unknown
 * record.
 */
export type SettledMetrics = {
  cagr: number | null;
  sharpe: number | null;
  record?: FigureRecord;
};

/** One constituent's verdict and the record it was judged on (for the cell's title text). */
export type ConstituentFigure = {
  figureState: FigureState;
  figureRecord: FigureRecord;
};

const UNKNOWN_RECORD: FigureRecord = { spanDays: null, observations: null, crypto: false };

/** The verdict for a leg with no readable record: the stored figure shows as today. */
export const UNKNOWN_CONSTITUENT_FIGURE: ConstituentFigure = {
  figureState: gateAnnualized(UNKNOWN_RECORD),
  figureRecord: UNKNOWN_RECORD,
};

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The lazy route's body at the client boundary: finite numbers, and crypto and unreadable only for
 * boolean true. `figure_unreadable` (R2 WR-01) is the route's one way to say the record's dates
 * could not be read; it makes `gateAnnualized` answer "withheld". Takes the body as an open record
 * so the composer's fetch-time cast needs no new keys.
 */
export function parseConstituentRecord(body: Readonly<Record<string, unknown>>): FigureRecord {
  return {
    spanDays: finiteOrNull(body.figure_span_days),
    observations: finiteOrNull(body.figure_observations),
    crypto: body.figure_crypto === true,
    ...(body.figure_unreadable === true ? { unreadable: true as const } : {}),
  };
}

type BookScalars = {
  figure_span_days?: number | null;
  figure_observations?: number | null;
  figure_crypto?: boolean;
  figure_unreadable?: boolean;
};

/**
 * The verdict for one added constituent. A book strategy wins (as it does for the values), read with
 * the same reconstruction `gatedSharpe` uses; otherwise a settled lazy entry's record; otherwise the
 * unknown record (pending, unavailable, or a settled entry with no record).
 */
export function constituentFigure(
  bookStrategy: BookScalars | undefined,
  lazyEntry: SettledMetrics | "unavailable" | undefined,
): ConstituentFigure {
  let record: FigureRecord;
  if (bookStrategy !== undefined) {
    record = {
      spanDays: bookStrategy.figure_span_days ?? null,
      observations: bookStrategy.figure_observations ?? null,
      crypto: bookStrategy.figure_crypto ?? false,
      ...(bookStrategy.figure_unreadable === true ? { unreadable: true as const } : {}),
    };
  } else if (lazyEntry !== undefined && lazyEntry !== "unavailable" && lazyEntry.record !== undefined) {
    record = lazyEntry.record;
  } else {
    return UNKNOWN_CONSTITUENT_FIGURE;
  }
  return { figureState: gateAnnualized(record), figureRecord: record };
}

/** One annualised figure's cell: the gated value through `format`, with the withheld / short idiom. */
export function constituentCell(
  value: number | null,
  figure: ConstituentFigure,
  format: (v: number | null) => string,
): ReactNode {
  return annualizedCell(
    format(gatedValue(value, figure.figureState)),
    figure.figureState,
    figure.figureRecord,
  );
}
