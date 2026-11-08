import type { ReactNode } from "react";
import { annualizationPeriods } from "@/lib/closed-sets";
import {
  figureRecord,
  withheldCellTitle,
  shortTrackMarkerTitle,
  SHORT_TRACK_MARKER,
  type FigureRecord,
  type FigureState,
} from "@/lib/figure-gate";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

// Phase 194 review V-a - the discovery list's annualised-figure cell, shared by the
// table row and the grid card so the two views of the same page cannot disagree about
// a figure (D-69, one number or neither). Moved out of StrategyTable.tsx unchanged
// (StrategyTable imports StrategyGrid, so the grid cannot import it back).

type RowWithAnalytics = Pick<Strategy, "asset_class"> & { analytics: StrategyAnalytics };

// Phase 194 plan 06 (D-15) — the row's TOTAL record, built once from the three
// scalar aliases beside `series_end` and the strategy's asset class. The verdict is
// `gateAnnualized(record)` with no window: a list row shows the strategy's full
// history, and only the total record can withhold (a window never does).
export function rowRecord(s: RowWithAnalytics): FigureRecord {
  return figureRecord({
    seriesStart: s.analytics.series_start,
    seriesEnd: s.analytics.series_end,
    headlineSince: s.analytics.headline_since,
    observations: s.analytics.record_observations ?? null,
    periodsPerYear: annualizationPeriods(s.asset_class),
  });
}

// An annualised figure's cell. Withheld: a toneless `—` whose reason is in `title`
// and in sr-only text. Short (cleared record, under one year): the figure plus the
// `<1y` marker, same slot and classes as the percentile suffix, reason likewise.
// Otherwise the figure as stored. Tone is chosen by the caller from the GATED value,
// so a withheld or null figure is never tinted (D-05).
export function annualizedCell(
  text: string,
  state: FigureState,
  record: FigureRecord,
): ReactNode {
  if (state === "withheld") {
    const reason = withheldCellTitle(record);
    return (
      <span title={reason}>
        —<span className="sr-only">{reason}</span>
      </span>
    );
  }
  // `short` implies a known span (a null span gives state `null`), so the guard
  // never drops a real marker; it only keeps the type honest without a fallback number.
  if (state === "short" && record.spanDays != null) {
    const reason = shortTrackMarkerTitle(record.spanDays);
    return (
      <>
        {text}
        <span
          title={reason}
          className="ml-1 inline-block min-w-[3ch] text-right align-baseline text-micro font-mono tabular-nums text-text-muted"
        >
          {SHORT_TRACK_MARKER}
          <span className="sr-only"> {reason}</span>
        </span>
      </>
    );
  }
  return text;
}
