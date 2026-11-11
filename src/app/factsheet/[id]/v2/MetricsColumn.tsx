"use client";

import { useRef, type ReactNode } from "react";
import { ResponsiveTable } from "@/components/ResponsiveTable";
import { Term } from "@/components/ui/Term";
import type { TermKey } from "@/lib/glossary";
import { formatDay, formatMonth } from "@/lib/utils";
import type { ComparatorBlock, ComparatorSummary, FactsheetPayload, JointMetrics } from "@/lib/factsheet/types";
import { formatRecordLength } from "@/lib/factsheet/record-length";
import { recordCoversWindow } from "@/lib/factsheet/compute";
import { COMPARATOR_CALENDARS, isPastCoverage, startsAfterCoverage, type WeekdayCalendar } from "@/lib/factsheet/align";
import { flatLegReason, pairedFloorReason } from "@/lib/factsheet/joint";
import { joinGuardPhrases } from "@/lib/factsheet/headline-basis";
import { benchmarkWithheldReason, nativeUnitReason, withUnit } from "@/lib/factsheet/returns-unit";
import { drawdownTone, signTone } from "@/lib/factsheet/display-sign";
import {
  VAR_METHOD_LINE,
  benchCoverageNote,
  gateAnnualized,
  gatedValue,
  shortTrackNote,
  coveredDays,
  widenedShortNote,
  widenedWithheldReason,
  withheldReason,
  type FigureRecord,
  type FigureState,
  type RollingVerdict,
} from "@/lib/figure-gate";
import { pct, pctSigned, ppDelta, ratio, signed } from "./format";
import { usePayload, useActiveComparator, useXRange } from "./factsheet-context";
import { useBasisOrCash, useBasisSeriesView, useWindowedView, useAppliedLeverage, leverageApplies, type Basis, type RangeScope } from "./basis-context";
import { CalmarByYearPanel, BootstrapCIPanel, FULL_HISTORY_NOTE, ScopeNote } from "./AnalyticalPanels";
import { StyleDriftPanel, PeerPercentilePanel, OwnBookDeltaPanel } from "./BatchDPanels";
import { StrategyThesisPanel, TermsPanel, LeverageProfilePanel, ConstituentMandatePanel } from "./MandatePanels";

/**
 * Phase 164.6.6.3.3 FACTSHEETTRUTH (D-01, D-03, UI-SPEC 1.3) — the note that says
 * which span the headline figures cover. It replaces Phase 169's SFH H-1 caveat
 * (`headlineCoverageCaveat`), which named three figures and only for a single key.
 *
 * Since plan 01 every stored headline stat is computed on ONE post-break suffix
 * (`headline_since`), and plan 02 carries the date and the closed guard-reason set
 * into `dataQuality` on both the composite and the single-key arm. So the note is
 * the same for both, and it names the span in each slot that shows headline
 * figures. The sentences are UI-SPEC 1.3, verbatim; `{D}`, `{R}` and `{B}` are the
 * only slots.
 *
 * Gates (UI-SPEC 1.1): the basis is cash settlement (under mark-to-market or
 * smoothed the figures come from that basis's series, not the stored headline),
 * and `twrChainBroken === true`. Then, once (UI-SPEC 1.3):
 *   1. `headlineWithheld === true`  -> "withheld": a legacy mixed-basis row whose
 *      figures the read path has already nulled. Strip and Main Metrics only.
 *      D-14 (R2-03): `headlineWithheldCause` picks the sentence: "recomputing"
 *      reads "Headline figures are being recomputed."; "failed" has no note (the
 *      page's failed status line is the one cause); absent is the original.
 *   2. a valid `headlineCoversFrom` -> "dated": the figures are shown, the span is named.
 *   3. otherwise                    -> null. The read path never produces this
 *      state (a unit test pins it); it is not a rendering state.
 * There is no full-history undated variant, and the date is never invented.
 *
 * The text carries no warning glyph. The slot renders `WITHHELD_GLYPH` on the
 * "withheld" variant only (B17); a Dated note is a steady-state statement.
 */
export type HeadlineNoteSlot = "strip" | "stripRelative" | "main" | "returns" | "maxdd" | "cumulative";

export interface HeadlineNote {
  variant: "dated" | "withheld";
  text: string;
}

/** The warning glyph (U+26A0 and a space): rendered on the "withheld" variant only. */
const WITHHELD_GLYPH = "⚠ ";

/** Muted for a Dated note (a broken chain is permanent), amber for a Withheld one (recoverable). */
export function headlineNoteColor(variant: HeadlineNote["variant"]): string {
  return variant === "withheld" ? "var(--color-warning, #B45309)" : "var(--color-text-muted, #64748B)";
}

export function headlineNoteGlyph(variant: HeadlineNote["variant"]): string {
  return variant === "withheld" ? WITHHELD_GLYPH : "";
}

/** `{D}` is a real date or nothing: a malformed value is an absent one. */
function coveredFromDate(dataQuality: NonNullable<FactsheetPayload["dataQuality"]>): string | null {
  const from = dataQuality.headlineCoversFrom;
  if (typeof from !== "string") return null;
  const date = isoToMonthDay(from);
  return date === "—" ? null : date;
}

/**
 * Phase 164.6.6.3.3 plan 13 (D-15, review WR-04) — the ONE test for "this row's headline is
 * Withheld": the cash basis, a chain-broken row, and the stored headline withheld (any
 * cause: unmeasured, recomputing, failed). {@link headlineCoverageNote} chooses its Withheld
 * sentence through it and the KPI strip dashes its α and IR cells through it, so the note and
 * the cells can never disagree about which rows are Withheld.
 */
export function isHeadlineWithheld(dataQuality: FactsheetPayload["dataQuality"], basis: Basis): boolean {
  return basis === "cash_settlement" && dataQuality?.twrChainBroken === true && dataQuality.headlineWithheld === true;
}

/**
 * Plan 15 round 3 (WR-01): the Withheld verdict at FULL history, with no window term. The one
 * place `isHeadlineWithheld` is combined with the what-if leverage term and the active basis, so
 * the rail and every full-history panel outside it (EOY bars, Monthly Returns, the rolling
 * charts) agree. The leverage term is provably false on a Withheld row (`leverageEligibleFor`
 * excludes chain-broken rows); it is kept so a change to eligibility moves strip and rail
 * together. The rail's slice-aware gate is `!selected && useFullHistoryWithheld()`.
 */
export function useFullHistoryWithheld(): boolean {
  const payload = usePayload();
  const basis = useBasisOrCash();
  const leverageApplied = leverageApplies(payload, basis, useAppliedLeverage());
  return !leverageApplied && isHeadlineWithheld(payload.dataQuality, basis);
}

export function headlineCoverageNote(
  dataQuality: FactsheetPayload["dataQuality"],
  basis: Basis,
  slot: HeadlineNoteSlot,
  opts: { benchShown?: boolean } = {},
): HeadlineNote | null {
  if (basis !== "cash_settlement") return null;
  if (dataQuality?.twrChainBroken !== true) return null;
  const reasons = joinGuardPhrases(dataQuality.headlineGuardReasons ?? []);
  if (isHeadlineWithheld(dataQuality, basis)) {
    if (slot !== "strip" && slot !== "stripRelative" && slot !== "main") return null;
    // D-14 (R2-03): the cause picks the sentence. A recompute says so and names no
    // span or reason; a failed row says nothing, because the page already states
    // that the analytics could not be computed and a second cause would contradict it.
    if (dataQuality.headlineWithheldCause === "recomputing") {
      return { variant: "withheld", text: "Headline figures are being recomputed." };
    }
    if (dataQuality.headlineWithheldCause === "failed") return null;
    return {
      variant: "withheld",
      text: `Headline figures withheld: earlier history is unreliable (it includes ${reasons}), and the span after it has not been measured yet.`,
    };
  }
  const date = coveredFromDate(dataQuality);
  if (date === null) return null;
  const both = opts.benchShown === true ? " in both columns" : "";
  const lead = `Measured since ${date}; earlier history is unreliable (it includes ${reasons}).`;
  switch (slot) {
    case "strip":
      return {
        variant: "dated",
        text: `${lead} Every figure in this strip covers only that span; the chart shows the whole record.`,
      };
    case "stripRelative":
      return {
        variant: "dated",
        text: `${lead} Every figure in this strip except α and IR covers only that span; α, IR and the chart cover the whole record.`,
      };
    case "main":
      return {
        variant: "dated",
        text: `${lead} Cumulative Return, CAGR, Ann. Volatility, Sharpe, Sortino and Calmar cover only that span${both}; Skew, Kurtosis and the chart cover the whole record.`,
      };
    case "returns":
      return {
        variant: "dated",
        text: `Measured since ${date}. The trailing returns cover only that span${both}; Win Rate and Profit Factor cover the whole record.`,
      };
    case "maxdd":
      return {
        variant: "dated",
        text: `Measured since ${date}. Max Drawdown covers only that span${both}; the other figures in this panel cover the whole record.`,
      };
    case "cumulative":
      return { variant: "dated", text: `Measured since ${date}. Every return in this panel covers only that span.` };
  }
}

/**
 * Phase 164.6.6.3.3 (UI-SPEC 1.3, "Selected range") — the note for a SELECTED
 * range, rendered in place of {@link headlineCoverageNote} in the strip and Main
 * Metrics while a range is selected (it replaces Phase 169.1's SFH MEDIUM-2 caveat).
 *
 * A window's figures are re-derived on the slice (`windowView`), which compounds
 * every return in it, while the full-history figures cover only the record from
 * `{D}`. After D-01 every headline figure is on that suffix, so the subject is
 * "Its figures". A range starting ON or AFTER `{D}` compounds only days the
 * full-history figures also compound: no note. A range starting before it says so.
 * A Withheld row has no `{D}` at all, but a range is re-derived from the stored
 * series, so its figures DO show and may span the break; that is the one undated
 * sentence left, and it is reachable.
 *
 * Same gates as {@link headlineCoverageNote}. A chain-broken row with neither a
 * valid date nor the withheld flag (the unreachable arm 3) gets none.
 */
export function windowCoverageNote(
  dataQuality: FactsheetPayload["dataQuality"],
  basis: Basis,
  rangeStart: string,
): HeadlineNote | null {
  if (basis !== "cash_settlement") return null;
  if (dataQuality?.twrChainBroken !== true) return null;
  if (dataQuality.headlineWithheld === true) {
    return {
      variant: "withheld",
      text: "The record has a break in the return chain at a date this view cannot name, so this range may span it. Its figures compound across any break inside it.",
    };
  }
  const date = coveredFromDate(dataQuality);
  const from = dataQuality.headlineCoversFrom;
  if (date === null || typeof from !== "string") return null;
  if (rangeStart.slice(0, 10) >= from.slice(0, 10)) return null;
  return {
    variant: "dated",
    text: `This range starts before ${date}, where the full-history figures begin. Its figures include returns from before that date, which the full-history figures leave out.`,
  };
}

/**
 * Phase 164.6.6.3.3 plan 10 (B19, UI-SPEC 1.5) — the comparator summary the rail's
 * HEADLINE rows read, so each row compares two figures over ONE span. Same gates as
 * {@link headlineCoverageNote}: the cash basis, a chain-broken row, full history.
 *   - a Withheld row has no measured span to compare against: `null`, so every headline
 *     benchmark cell prints "—";
 *   - a Dated row reads `summarySince`, the comparator over the covered returns from
 *     `{D}`. A block without the member (a re-derived view, whose strategy figures are
 *     whole-record too) keeps the whole-record summary;
 *   - anything else (a clean row, MTM or smoothed, a selected range, where the windowed
 *     view already slices both legs) keeps the whole-record summary.
 * Win Rate, Profit Factor and Longest DD never read this: they stay whole-record.
 */
export function headlineBenchSource(
  dataQuality: FactsheetPayload["dataQuality"],
  basis: Basis,
  selected: boolean,
  block: ComparatorBlock,
): ComparatorSummary | null {
  if (selected || basis !== "cash_settlement" || dataQuality?.twrChainBroken !== true) return block.summary;
  if (dataQuality.headlineWithheld === true) return null;
  return block.summarySince !== undefined ? block.summarySince : block.summary;
}

/** Which half of the rail `MetricsColumn` renders (Phase 196, D-04). */
export type MetricsPart = "all" | "main" | "detailed";

/**
 * Editorial right-column metrics. Four named sections — Performance, Risk,
 * Style, Benchmark — each introduced by a serif-italic eyebrow over a thick
 * hairline divider, then a stack of dense KPM tables.
 *
 * No card chrome between sub-panels: hairline section dividers carry the
 * structure, matching DESIGN.md's "data density > card density" rule and
 * the FactSet quarterly-factsheet reference.
 */
export function MetricsColumn({
  scenarioMode = false,
  part = "all",
}: {
  scenarioMode?: boolean;
  /**
   * Phase 196 (D-04, LEAN-05): which half of the rail to render. `"all"` (the default, every
   * existing mount) is the whole rail, unchanged. `"main"` is the one Main metrics table of the
   * opening view; `"detailed"` is everything else, for inside Advanced, with every row the
   * Main metrics table or the KPI strip owns removed (UI-SPEC "Metric home table").
   */
  part?: MetricsPart;
}) {
  // Phase 42 (PEER-01, ADR-0025): scenarioMode now gates the additive
  // scenarioPeer carve-out below. It is false on every existing call site (the
  // real route, Discovery, Overview), so the api peer path is provably
  // unchanged; only the composer passes scenarioMode={true}.
  const payload = usePayload();
  const { block: cmp, key: cmpKey } = useActiveComparator();
  // Phase 103 (MTM-04, root-cause flip) — every comparator-derived read on this rail
  // (§I/§II benchmark columns `b`, and §IV joint α/β/corr/IR/treynor/…) comes from the
  // VIEW's comparator, matching the strategy scalars `m` which also read the view
  // below. So the WHOLE Main-Metrics/Benchmark surface sits on ONE coherent basis:
  // strategy + benchmark BOTH follow the active basis (no mixed-basis panel). The
  // per-basis bundle already computes the comparator summary + joint from the
  // basis-selected strat returns + the benchmark series (buildComparatorBlock →
  // compute/jointMetrics), so no new math and no persisted overlay is needed.
  // Byte-identical under cash (the view returns payload by reference) and MTM-derived
  // under mark_to_market. `cmp` (the cash comparator) is retained ONLY for the
  // basis-invariant shortName label `bn` below.
  // Phase 169.1 (SC10, D-27): the rail's window-dependent figures read the WINDOWED
  // view, the same one the KPI strip reads. At full history it is the active view
  // BY REFERENCE, so every figure below is unchanged there; inside a selected range
  // it is that view re-derived on the slice (`useWindowedView`, basis-context.tsx).
  const { view, scope } = useWindowedView(payload);
  const selected = scope.kind === "selected";
  const jointCmp = view.comparators[cmpKey];
  // Phase 103 (MTM-04, root-cause flip) — §I Performance/Main-Metrics + §II
  // MaxDD/Best-Worst read the strategy scalars from the VIEW, so the whole rail
  // follows the active basis (dissolving the double-display contradiction where
  // ExtendedMetricsPanel already read view.strategyMetrics while §I/§II stayed
  // cash). Under cash the view returns `payload` by reference, so `m` is
  // byte-identical to the persisted cash overlay (SC-4 safe by construction);
  // under mark_to_market it is the bundle's compute() on the MTM series. The
  // bundle's strategyMetrics is the same ComputeSummary shape (compute() minus
  // the eq/dd curves the rail never reads), so every consumed field is present.
  const m = view.strategyMetrics;
  const b = jointCmp.summary;
  const railBasis = useBasisOrCash();
  // Plan 15 (D-15 extended again, founder 2026-10-15, "Dash all of them", superseding plan 14's
  // Alpha-only line): on a Withheld row every rail figure computed over the WHOLE record
  // compounds across the break the Withheld note names, so it reads "—" with no tone. This is
  // the ONE rail gate: it is computed here once and passed to every panel that dashes, and no
  // panel decides Withheld for itself. The scope mirrors `KpiStrip`'s `relativeWithheld`: full
  // history (D-78: a selected window keeps its slice figures), no what-if leverage, and the
  // shared isHeadlineWithheld verdict. The leverage term is provably false on a Withheld row
  // (`leverageEligibleFor` excludes chain-broken rows); it is kept so a change to eligibility
  // moves strip and rail together. Which rows it covers (and which cells are dates, sample
  // counts or per-period entries and stay) is the classification table in the plan 15 SUMMARY.
  //
  // Plan 15 round 3 (WR-01): the verdict has TWO scopes. `fullHistoryWithheld` is the verdict
  // itself, with no window term: it governs every figure that always shows the FULL history,
  // inside a zoom as well (EOY Returns, Calmar by Year, the EOY bars, the Monthly Returns YTD
  // column, the rolling charts' "avg"). `wholeRecordWithheld` adds `!selected` (D-78), for the
  // panels that read the windowed view and keep their slice figure inside a zoom. Both come
  // from here, once, so no panel decides Withheld for itself.
  const fullHistoryWithheld = useFullHistoryWithheld();
  const wholeRecordWithheld = !selected && fullHistoryWithheld;
  const wr = (formatted: string) => dashIf(wholeRecordWithheld, formatted);
  // B19: the benchmark cells beside the headline rows (see headlineBenchSource).
  const hb = headlineBenchSource(payload.dataQuality, railBasis, selected, jointCmp);
  // UI-SPEC 1.6 (B20): 6 Month / 1 Year row presence follows the record's length (the
  // view's own dates, not a range), never the value.
  const covers6m = recordCoversWindow(view.dates, 182);
  const covers1y = recordCoversWindow(view.dates, 365);
  // shortName is "—" when no comparator selected — Panel.benchHeader treats
  // any non-empty string as a real comparator and renders "vs —" in the
  // header. Pass undefined instead so the "vs" label disappears entirely
  // when there's nothing to compare against.
  const bn = cmpKey === "none" ? undefined : cmp.shortName;
  // Phase 169.5 (SFH-M-05, keeps D-54): a comparator whose prices stop before the
  // strategy's last date is measured over its covered days only, so its Main
  // Metrics / Returns / Max Drawdown figures cover a shorter span than the
  // strategy's beside them. The bench column header carries the date the
  // comparator's figures run to, next to the numbers. Full coverage, an
  // unavailable comparator (every figure already "—") and an absent `through`
  // leave the header as it was.
  const benchThrough =
    cmpKey === "none"
      ? null
      : comparatorPartialThrough(jointCmp.through, view.dates[view.dates.length - 1], COMPARATOR_CALENDARS[cmpKey]);
  const bnDated = bn != null && benchThrough != null ? `${bn} to ${isoToMonthDay(benchThrough)}` : bn;
  // Phase 169 D-12 / D-25 (SC5): the record length is stated one way, from the
  // calendar years compute() reports, at Years Observed and in the warning below.
  // Dividing the observation count by the basis read a sparse record short.
  const recordLength = formatRecordLength({ n: m.n, years: m.years });
  // The span note describes the STORED headline, which a selected range does not
  // show (D-78). A selected range that starts before `{D}` gets its own sentence
  // instead: its re-derived figures include returns the full-history figures leave
  // out (169.1 review round 1, SFH MEDIUM-2; the KPI strip's rule). S2, S3 and S4 pass
  // `benchShown` when a comparator is selected: the headline rows' benchmark cells
  // cover the same span (`headlineBenchSource`, UI-SPEC 1.5), so the `{B}` clause is
  // true. It ships with that change and nowhere else.
  const benchShown = cmpKey !== "none";
  const spanNote = selected
    ? windowCoverageNote(payload.dataQuality, railBasis, scope.start)
    : headlineCoverageNote(payload.dataQuality, railBasis, "main", { benchShown });
  // UI-SPEC 1.3 S3 and S4, full history only: while a range is selected the trailing
  // rows are hidden (the `window-trailing-note` speaks) and the range sentence above
  // carries the span, so the labels would restate a span the panel no longer shows.
  const returnsSpan = selected ? null : headlineCoverageNote(payload.dataQuality, railBasis, "returns", { benchShown });
  const maxDdSpan = selected ? null : headlineCoverageNote(payload.dataQuality, railBasis, "maxdd", { benchShown });

  // Phase 194 (D-04 as superseded by D-15, TRUST-05): ONE gate for the rail. The TOTAL
  // record (`payload.figureRecord`, the same object at full history and inside a range)
  // decides whether CAGR, Ann. Volatility, Sharpe, Sortino and Calmar show; the window
  // shown only qualifies them with one muted note under a year. A selected range is never
  // withheld for being short. In the Scenario composer the record is the blend's, so the
  // note speaks of the blend (its engine is used only for blends, D-01).
  const figureRec = payload.figureRecord ?? null;
  const gateWindowSpan = selected ? coveredDays(scope.start, scope.end) : undefined;
  const gateState = figureRec ? gateAnnualized(figureRec, gateWindowSpan) : "null";
  const gateNote =
    figureRec && gateState === "withheld"
      ? withheldReason(scenarioMode ? "blend" : "record", figureRec)
      : figureRec && gateState === "short"
        ? shortTrackNote(scenarioMode ? "blend" : selected ? "range" : "record", gateWindowSpan ?? figureRec.spanDays ?? 0)
        : null;
  const gv = (value: number | null | undefined) => gatedValue(value, gateState);
  // 194 D-16 (review round 2 WR-01): the benchmark's annualized cells are measured over the
  // comparator's OWN covered span, which can be under a year while the strategy's record is not
  // (a comparator whose data starts late). Its cells then carry the same muted note, naming the
  // benchmark. Shown only while the cells show: D-19 withholds them with the strategy's total
  // record, and a selected range's note already speaks of the window.
  // 194 R5 SFH-M2 (D-17): a covered span that could not be read dashes those cells with no
  // length to name; the reason is the gate's unreadable sentence, on a range as well as the
  // whole record (the cells are dashed in both).
  const benchNote =
    bn != null && gateState !== "withheld" && hb != null && jointCmp.coveredSpanUnreadable
      ? `${bn}: ${withheldReason("record", { ...(figureRec ?? UNKNOWN_RECORD), unreadable: true })}`
      : bn != null && selected && gateState !== "withheld" && hb != null && cmpKey !== "none"
        ? selectedRangeBenchNote(bn, jointCmp, scope, COMPARATOR_CALENDARS[cmpKey])
        : bn != null && !selected && gateState !== "withheld" && hb != null && jointCmp.coveredShortSpanDays != null
          ? `${bn}: ${shortTrackNote("record", jointCmp.coveredShortSpanDays)}`
          : null;

  // Phase 196 (D-04): Style drift is the one Style panel that can render nothing on a
  // non-scenario factsheet; the detailed part reads it here so it can leave the whole section
  // out instead of printing an empty heading (UI-SPEC "Empty sections").
  const hasStyleDrift = useBasisSeriesView(payload).styleDrift != null;

  // Best / Worst Period and Section IV are used by the whole rail and by the detailed part, so
  // each is built once here. `variant` only reaches Section IV's body: "document" drops the
  // two rows the KPI strip owns (UI-SPEC "Metric home table").
  const bestWorstPanel = (
    <Panel title="Best / Worst Period">
      <table className="w-full text-fixed-11">
        <thead>
          <tr className="border-b border-text">
            <th className="text-left py-1 pr-2 font-mono text-fixed-9 uppercase tracking-[0.18em] text-text-muted">Scale</th>
            <th className="text-right py-1 px-2 font-mono text-fixed-9 uppercase tracking-[0.18em] text-text-muted">Best</th>
            <th className="text-right py-1 pl-2 font-mono text-fixed-9 uppercase tracking-[0.18em] text-text-muted">Worst</th>
          </tr>
        </thead>
        <tbody>
          <BwRow scale="Day" best={m.best_day} worst={m.worst_day} dash={wholeRecordWithheld} />
          <BwRow scale="Week" best={m.best_week} worst={m.worst_week} dash={wholeRecordWithheld} />
          <BwRow scale="Month" best={m.best_month} worst={m.worst_month} dash={wholeRecordWithheld} />
          <BwRow scale="Quarter" best={m.best_quarter} worst={m.worst_quarter} dash={wholeRecordWithheld} />
          <BwRow scale="Year" best={m.best_year} worst={m.worst_year} dash={wholeRecordWithheld} />
        </tbody>
      </table>
    </Panel>
  );
  // Phase 201 (D-10): the Benchmark section is a name and its children, or null; the numeral is
  // assigned by `NumberedSections` from the section's place among those that render.
  const benchmarkSection = (variant: "full" | "document"): SectionSpec | null => {
    if (payload.returnsUnit && cmpKey === "none") {
      // Phase 164.6.6.2 (D-10, UI-SPEC A15): a strategy whose returns are in a native
      // unit has no BTC benchmark (measured in BTC it is a flat line; the USD-priced
      // one mixes units), so the section stays, every row reads "—", and one line says why
      // ("show null with the reason"). With SPX active the arms below render as today.
      return {
        name: "Benchmark — vs BTC",
        children: (
          <BenchmarkMetricsBody
            variant={variant}
            joint={null}
            withheldReason={
              // Phase 164.6.6.2.1 (D-15): the USD view's returns were CONVERTED, so the
              // native view's "flat line" sentence is false there; it says why in its own words.
              payload.convertedFrom != null
                ? `Not measurable: ${benchmarkWithheldReason(payload.returnsUnit, payload.convertedFrom)}, so they carry the ${payload.convertedFrom} price by construction.`
                : `Not measurable: ${benchmarkWithheldReason(payload.returnsUnit)}. A BTC benchmark measured in ${payload.returnsUnit} is a flat line.`
            }
          />
        ),
      };
    }
    if (jointCmp.joint) {
      return {
        name: `Benchmark — vs ${bn}`,
        // Phase 164.6.6.3.3 (D-04, UI-SPEC 2.2): a flat strategy leg's joint carries NaN for
        // alpha, beta, IR and the captures ("—") and the block's `flatLeg` marker picks the
        // one muted reason line. The marker, never the NaN values, selects it.
        children: (
          <BenchmarkMetricsBody
            variant={variant}
            joint={wholeRecordWithheld ? null : jointCmp.joint}
            withheldReason={jointCmp.flatLeg && !wholeRecordWithheld ? flatLegReason(selected ? "range" : "record") : undefined}
            reasonTestId="joint-flat-leg-reason"
            annualizationNote={wholeRecordWithheld ? undefined : jointAnnualizationNote(jointCmp.jointAnnualization, figureRec)}
          />
        ),
      };
    }
    if (jointCmp.jointWithheld && bn != null) {
      // 169.4 review round 2 (SFH-R2 MEDIUM-2): below the paired floor the section
      // stays, every joint figure reads "—" and one muted line names the
      // cause in the Allocations widget's words. No figure is shown (D-69).
      return {
        name: `Benchmark — vs ${bn}`,
        children: (
          <BenchmarkMetricsBody
            variant={variant}
            joint={null}
            withheldReason={pairedFloorReason(
              bn,
              jointCmp.jointWithheld.paired,
              // D-85: inside a window the count is the slice's, named as the range's.
              selected ? "range" : "record",
              jointCmp.jointWithheld.floor,
              // D-08 (170.6): dated only when the comparator's prices end before the strategy's.
              benchThrough,
            )}
          />
        ),
      };
    }
    return null;
  };

  // Phase 196 (D-04, LEAN-05) — the two halves of the rail the one-page layout mounts: `main` in
  // the opening view, `detailed` inside Advanced. Every figure below is the same expression the
  // whole rail uses (same `gv` / `wr` wrappers and formatters), moved; none is re-derived, so the
  // Phase 194 gate decides exactly what it decided before. Home table: UI-SPEC "Metric home table".
  if (part === "main") {
    return (
      <aside className="flex flex-col gap-6">
        <RangeEyebrow scope={scope} surface="rail" />
        <Panel title="Main metrics" benchHeader={bnDated}>
          {/* Phase 196 (UI-SPEC "One small-sample warning"): the rail's `figure-gate-note` is not
              rendered here; the KPI strip's note is the page's one small-sample statement.
              `bench-figure-gate-note` (comparator-specific) and the span note stay. */}
          {benchNote && (
            <p className="mb-2 text-fixed-10 italic text-text-muted" data-testid="bench-figure-gate-note">
              {benchNote}
            </p>
          )}
          {spanNote && (
            <p className="mb-2 text-fixed-10 italic" style={{ color: headlineNoteColor(spanNote.variant) }}>
              {headlineNoteGlyph(spanNote.variant)}
              {spanNote.text}
            </p>
          )}
          <GroupHeading first>Record</GroupHeading>
          <Kpm>
            <Row label="Start Date" value={isoToMonthDay(m.start)} bench="" />
            <Row label="End Date" value={isoToMonthDay(m.end)} bench="" />
            <Row label="Years Observed" value={recordLength.years} bench="" />
          </Kpm>
          <GroupHeading>Returns</GroupHeading>
          {selected && (
            <p className="mb-2 text-fixed-11 text-text-muted" data-testid="window-trailing-note">
              The trailing and since-inception returns end on the record&apos;s last date, so they are hidden while a range is selected; resetting the range shows them.
            </p>
          )}
          {returnsSpan && <p className="mb-2 text-fixed-10 italic text-text-muted">{returnsSpan.text}</p>}
          <Kpm>
            {!selected && (
              <>
                <Row windowKey="mtd" label={monthRowLabel(m.end)} value={pctSigned(m.mtd, 2)} bench={pctSigned(hb?.mtd, 2)} />
                <Row windowKey="ytd" label="Year-to-date" value={pctSigned(m.ytd, 2)} bench={pctSigned(hb?.ytd, 2)} />
                <Row windowKey="p3m" label="3 Month" value={pctSigned(m.p3m, 2)} bench={pctSigned(hb?.p3m, 2)} />
                {(m.p6m != null || covers6m) && <Row windowKey="p6m" label="6 Month" value={pctSigned(m.p6m, 2)} bench={pctSigned(hb?.p6m, 2)} />}
                {(m.p1y != null || covers1y) && <Row windowKey="p1y" label="1 Year" value={pctSigned(m.p1y, 2)} bench={pctSigned(hb?.p1y, 2)} />}
                {m.p3y != null && <Row label="3 Year" value={pctSigned(m.p3y, 2)} bench="" />}
                {m.p5y != null && <Row label="5 Year" value={pctSigned(m.p5y, 2)} bench="" />}
              </>
            )}
            <Row label="Win Rate (days)" value={wr(pct(m.win_rate, 2))} bench={wr(pct(b?.win_rate, 2))} />
            <Row term="profit_factor" label="Profit Factor" value={wr(ratio(m.profit_factor))} bench={wr(ratio(b?.profit_factor))} />
          </Kpm>
          <GroupHeading>Risk</GroupHeading>
          {maxDdSpan && <p className="mb-2 text-fixed-10 italic text-text-muted">{maxDdSpan.text}</p>}
          <Kpm>
            <Row term="dd_duration" label="Longest DD (days)" value={wr(count(m.longest_dd))} bench={wr(count(b?.longest_dd))} />
            <Row term="var_95" label="VaR 95%" value={wr(pctSigned(m.var95, 2))} bench="" />
            <Row term="cvar_95" label="CVaR 95%" value={wr(pctSigned(m.cvar95, 2))} bench="" />
            <Row label="Avg Win" value={wr(pctSigned(m.avg_win, 2))} bench="" />
            <Row label="Avg Loss" value={wr(pctSigned(m.avg_loss, 2))} bench="" />
            <Row term="skew" label="Skew" value={wr(signed(m.skew))} bench="" />
            <Row term="kurtosis" label="Kurtosis (excess)" value={wr(ratio(m.kurt))} bench="" accent={m.kurt > 6} />
          </Kpm>
          <p className="mt-2 text-fixed-10 italic text-text-muted" data-testid="var-method-line">{VAR_METHOD_LINE}</p>
        </Panel>
      </aside>
    );
  }

  if (part === "detailed") {
    return (
      <aside className="flex flex-col gap-12">
        <header className="border-b border-border pb-1">
          <h3 className="text-fixed-12 font-semibold uppercase tracking-[0.18em] text-text-primary">Detailed metrics</h3>
        </header>
        <StrategyThesisPanel />
        <NumberedSections
          sections={[
            {
              name: "Performance",
              children: (
                <>
                  <EoyReturnsPanel scopeNote={selected ? FULL_HISTORY_NOTE : undefined} fullHistoryWithheld={fullHistoryWithheld} />
                  <RollingMetricsPanel scope={scope} wholeRecordWithheld={wholeRecordWithheld} record={figureRec} variant="document" />
                </>
              ),
            },
            {
              name: "Risk",
              children: (
                <>
                  <BootstrapCIPanel wholeRecordWithheld={wholeRecordWithheld} figureState={gateState} variant="document" />
                  {bestWorstPanel}
                  <CalmarByYearPanel fullHistoryWithheld={fullHistoryWithheld} />
                  <WorstDrawdownsTablePanel />
                  <ExtendedMetricsPanel wholeRecordWithheld={wholeRecordWithheld} variant="document" />
                </>
              ),
            },
            (hasStyleDrift || scenarioMode) && {
              name: "Style",
              scopeNote: selected ? FULL_HISTORY_NOTE : undefined,
              children: (
                <>
                  <StyleDriftPanel />
                  {scenarioMode && payload.ingestSource === "csv" && payload.scenarioPeer != null && <PeerPercentilePanel />}
                  {scenarioMode && <OwnBookDeltaPanel />}
                </>
              ),
            },
            {
              name: "Terms",
              children: (
                <>
                  {scenarioMode && <ConstituentMandatePanel />}
                  <LeverageProfilePanel />
                  <TermsPanel variant="document" />
                </>
              ),
            },
            benchmarkSection("document"),
          ]}
        />
      </aside>
    );
  }

  return (
    <aside className="flex flex-col gap-12">
      <StrategyThesisPanel />
      {/* Phase 169.1 (D-27): the range the rail's figures cover, as on the strip. */}
      <RangeEyebrow scope={scope} surface="rail" />
      <NumberedSections
        sections={[
      {
        name: "Performance",
        children: (
      <>
        <Panel title="Compound Performance">
          <Kpm>
            <Row label="Start Date" value={isoToMonthDay(m.start)} bench="" />
            <Row label="End Date" value={isoToMonthDay(m.end)} bench="" />
            <Row label="Years Observed" value={recordLength.years} bench="" />
          </Kpm>
        </Panel>
        <Panel title="Main Metrics" benchHeader={bnDated}>
          {/* Phase 194 (D-15): the amber observation-count sentence of 167.1.2 plan 07
              is gone; `figure-gate-note` below is the one note, from the shared gate. */}
          {gateNote && (
            <p className="mb-2 text-fixed-10 italic text-text-muted" data-testid="figure-gate-note">
              {gateNote}
            </p>
          )}
          {benchNote && (
            <p className="mb-2 text-fixed-10 italic text-text-muted" data-testid="bench-figure-gate-note">
              {benchNote}
            </p>
          )}
          {spanNote && (
            <p className="mb-2 text-fixed-10 italic" style={{ color: headlineNoteColor(spanNote.variant) }}>
              {headlineNoteGlyph(spanNote.variant)}
              {spanNote.text}
            </p>
          )}
          {/* 194 D-16 (review WR-01): the benchmark column follows D-15 like the strategy
              column. The 170.6 "need 90 days of overlap" line is gone; the one muted note
              above stands for both columns. D-19: the benchmark cells are withheld only with the strategy's TOTAL record (the same `gv`); no overlap or window length withholds them. */}
          <Kpm>
            <Row label={withUnit("Cumulative Return", payload.returnsUnit ?? null)} value={pctSigned(m.cum_ret, 2)} bench={pctSigned(hb?.cum_ret, 2)} />
            <Row term="cagr" label={withUnit("CAGR", payload.returnsUnit ?? null)} value={pctSigned(gv(m.cagr), 2)} bench={pctSigned(gv(hb?.cagr), 2)} />
            <Row term="volatility" label="Ann. Volatility" value={pct(gv(m.ann_vol), 2)} bench={pct(gv(hb?.ann_vol), 2)} />
            <Row term="sharpe" label="Sharpe" value={ratio(gv(m.sharpe))} bench={ratio(gv(hb?.sharpe))} accent />
            <Row term="sortino" label="Sortino" value={ratio(gv(m.sortino))} bench={ratio(gv(hb?.sortino))} />
            <Row term="calmar" label="Calmar" value={ratio(gv(m.calmar))} bench={ratio(gv(hb?.calmar))} />
            <Row term="skew" label="Skew" value={wr(signed(m.skew))} bench="" />
            <Row term="kurtosis" label="Kurtosis" value={wr(ratio(m.kurt))} bench="" />
          </Kpm>
        </Panel>
        <Panel title="Returns" benchHeader={bnDated}>
          {/* Phase 169 D-57, changed by 164.6.6.3.3 UI-SPEC 1.6 (B20, D-12): 6 Month /
              1 Year are omitted only when the WHOLE record is shorter than the window
              (`recordCoversWindow`, the rule compute() uses), and read "—" when the
              record covers it but the value is null (a Dated row's short suffix). A
              null bench value alone keeps the row. 3 Year / 5 Year keep D-17's null rule. */}
          {/* Phase 169.1 (D-27): the month, YTD, 3 Month, 6 Month and 1 Year rows end on
              the RECORD's last date, not the window's, so while a range is selected
              they are omitted, chosen by the compute() field each reads (never by
              label: 170-13 labels the month row by the record's state, D-79). */}
          {selected && (
            <p className="mb-2 text-fixed-11 text-text-muted" data-testid="window-trailing-note">
              The trailing and since-inception returns end on the record&apos;s last date, so they are hidden while a range is selected; resetting the range shows them.
            </p>
          )}
          {returnsSpan && <p className="mb-2 text-fixed-10 italic text-text-muted">{returnsSpan.text}</p>}
          <Kpm>
            {!selected && (
              <>
                <Row windowKey="mtd" label={monthRowLabel(m.end)} value={pctSigned(m.mtd, 2)} bench={pctSigned(hb?.mtd, 2)} />
                <Row windowKey="ytd" label="Year-to-date" value={pctSigned(m.ytd, 2)} bench={pctSigned(hb?.ytd, 2)} />
                <Row windowKey="p3m" label="3 Month" value={pctSigned(m.p3m, 2)} bench={pctSigned(hb?.p3m, 2)} />
                {(m.p6m != null || covers6m) && <Row windowKey="p6m" label="6 Month" value={pctSigned(m.p6m, 2)} bench={pctSigned(hb?.p6m, 2)} />}
                {(m.p1y != null || covers1y) && <Row windowKey="p1y" label="1 Year" value={pctSigned(m.p1y, 2)} bench={pctSigned(hb?.p1y, 2)} />}
              </>
            )}
            <Row label="Win Rate (days)" value={wr(pct(m.win_rate, 2))} bench={wr(pct(b?.win_rate, 2))} />
            <Row term="profit_factor" label="Profit Factor" value={wr(ratio(m.profit_factor))} bench={wr(ratio(b?.profit_factor))} />
          </Kpm>
        </Panel>
        <EoyReturnsPanel scopeNote={selected ? FULL_HISTORY_NOTE : undefined} fullHistoryWithheld={fullHistoryWithheld} />
        <RollingMetricsPanel scope={scope} wholeRecordWithheld={wholeRecordWithheld} record={figureRec} />
        {/* D-04: the panel mounts at full history only, so `gateState` here is the RECORD-scope verdict. */}
        {!selected && <CumulativeReturnsPanel figureState={gateState} />}
      </>
        ),
      },

      {
        name: "Risk",
        children: (
      <>
        {/* SFH-M-05: this panel carries no bench header at full coverage; it gains
            the dated one only when the comparator's figures stop early. */}
        <Panel term="max_drawdown" title="Max Drawdown" benchHeader={benchThrough != null ? bnDated : undefined}>
          {maxDdSpan && <p className="mb-2 text-fixed-10 italic text-text-muted">{maxDdSpan.text}</p>}
          <Kpm>
            <Row term="max_drawdown" label="Max Drawdown" value={pct(m.max_dd, 2)} bench={pct(hb?.max_dd, 2)} accent />
            <Row term="dd_duration" label="Longest DD (days)" value={wr(count(m.longest_dd))} bench={wr(count(b?.longest_dd))} />
            <Row term="var_95" label="VaR 95%" value={wr(pctSigned(m.var95, 2))} bench="" />
            <Row term="cvar_95" label="CVaR 95%" value={wr(pctSigned(m.cvar95, 2))} bench="" />
            <Row label="Avg Win" value={wr(pctSigned(m.avg_win, 2))} bench="" />
            <Row label="Avg Loss" value={wr(pctSigned(m.avg_loss, 2))} bench="" />
          </Kpm>
          <p className="mt-2 text-fixed-10 italic text-text-muted" data-testid="var-method-line">{VAR_METHOD_LINE}</p>
        </Panel>
        {/* D-04 / D-15: the panel follows the windowed view, so it gets the same record-scope verdict as the headline rows. */}
        <BootstrapCIPanel wholeRecordWithheld={wholeRecordWithheld} figureState={gateState} />
        {bestWorstPanel}
        <CalmarByYearPanel fullHistoryWithheld={fullHistoryWithheld} />
        <WorstDrawdownsTablePanel />
        <ExtendedMetricsPanel wholeRecordWithheld={wholeRecordWithheld} />
      </>
        ),
      },

      {
        name: "Style",
        scopeNote: selected ? FULL_HISTORY_NOTE : undefined,
        children: (
      <>
        <StyleDriftPanel />
        {/* PeerPercentile ranks the scenario BLEND — Phase 42 (PEER-01, ADR-0025):
            it carries an additive `scenarioPeer` ranked vs the REAL verified
            universe (never an ingestSource flip; the three genuinely-synthetic
            panels stay structurally absent). The explicit `ingestSource ===
            "csv"` narrow is required before reading the csv-only `scenarioPeer`
            field (Pitfall 3 — mirrors the B6 narrowing discipline). Phase 193
            (D-04) removed the api demo-cohort arm: a strategy factsheet no
            longer mounts this panel, so no synthesized cohort can be shown. */}
        {scenarioMode && payload.ingestSource === "csv" && payload.scenarioPeer != null && (
          <PeerPercentilePanel />
        )}
        {/* Phase 42 (PEER-05): the blend-vs-live-book signed delta, AFTER the
            peer panel (UI-SPEC §III). scenarioMode-gated here — the panel ALSO
            null-guards on its csv-only `scenarioOwnBookDelta` carve-out (silently
            absent without a live book), so non-scenario factsheets are
            byte-identical. */}
        {scenarioMode && <OwnBookDeltaPanel />}
      </>
        ),
      },

      {
        name: "Terms",
        children: (
      <>
        {/* Phase 42 (PEER-04): per-constituent mandate chips for the scenario
            BLEND, BEFORE TermsPanel (UI-SPEC §V). scenarioMode-gated here — the
            panel ALSO null-guards on its csv-only `scenarioMandate` carve-out, so
            on every existing (non-scenario) call site it renders nothing and §V
            stays byte-identical. */}
        {scenarioMode && <ConstituentMandatePanel />}
        <LeverageProfilePanel />
        <TermsPanel />
      </>
        ),
      },

          benchmarkSection("full"),
        ]}
      />
    </aside>
  );
}

/** Editorial section: roman-numeral eyebrow over an Instrument Serif name + thick rule. */
function EditorialSection({
  label,
  name,
  children,
  scopeNote,
}: {
  label: string;
  name: string;
  children: ReactNode;
  scopeNote?: string;
}) {
  return (
    <section className="flex flex-col gap-6">
      <header className="border-b-[2px] border-text pb-2">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-fixed-10 uppercase tracking-[0.28em] text-text-muted">
            §{label}
          </span>
          <h2 className="font-serif italic text-fixed-22 leading-tight text-text-primary">{name}</h2>
          {scopeNote && <ScopeNote text={scopeNote} />}
        </div>
      </header>
      {children}
    </section>
  );
}

/** Phase 201 (D-10): a section's name, optional scope note and body; the numeral is not stored. */
type SectionSpec = { name: string; scopeNote?: string; children: ReactNode };

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;

/**
 * Phase 201 (D-10, UI-SPEC Interaction contract 6): the one place section numerals are assigned.
 * The numeral is the section's position among the sections that rendered, so the sequence reads
 * I..N in the order a reader sees them whether or not Style or the benchmark is present. A
 * falsy entry is an absent section and takes no numeral. Section names are the caller's, byte
 * for byte.
 */
function NumberedSections({ sections }: { sections: ReadonlyArray<SectionSpec | null | false> }) {
  const shown = sections.filter((s): s is SectionSpec => Boolean(s));
  return (
    <>
      {shown.map((s, i) => (
        <EditorialSection key={s.name} label={ROMAN_NUMERALS[i] ?? String(i + 1)} name={s.name} scopeNote={s.scopeNote}>
          {s.children}
        </EditorialSection>
      ))}
    </>
  );
}

/**
 * Phase 194 (D-11 as superseded by D-15): the one muted line under section IV's joint figures.
 * Withheld only when the TOTAL record fails the gate (the wording names the record's own
 * bound and count, never the overlap); short when the overlap is under a year. Absent marker,
 * or a withheld verdict with no record to name, prints no line.
 */
const UNKNOWN_RECORD: FigureRecord = { spanDays: null, observations: null, crypto: false };

function jointAnnualizationNote(
  marker: ComparatorBlock["jointAnnualization"],
  record: FigureRecord | null,
): string | undefined {
  if (!marker) return undefined;
  if (marker.unreadable) return widenedWithheldReason("overlap", { ...(record ?? UNKNOWN_RECORD), unreadable: true });
  if (marker.state === "withheld") return record ? widenedWithheldReason("overlap", record) : undefined;
  return widenedShortNote("overlap", marker.days);
}

function BenchmarkMetricsBody({
  joint,
  withheldReason,
  reasonTestId = "joint-floor-reason",
  annualizationNote,
  variant = "full",
}: {
  /**
   * Phase 196 (D-04): `"document"` drops Alpha (ann) and Information Ratio, which the KPI strip
   * owns (UI-SPEC "Metric home table"); every other row is unchanged. `"full"` is today's body.
   */
  variant?: "full" | "document";
  joint: JointMetrics | null;
  withheldReason?: string;
  /** `joint-floor-reason` for the native-unit and paired-floor arms; the flat-leg arm passes its own. */
  reasonTestId?: "joint-floor-reason" | "joint-flat-leg-reason";
  /** Phase 194: the overlap annualization line, rendered after the reason line when present. */
  annualizationNote?: string;
}) {
  // A null joint (withheld below the paired floor) reads "—" in every row.
  // The dash-never-accent rule (UI-SPEC §6) lives in `Row` itself, so the alpha
  // dash is plain text whatever `accent` says.
  const v = (f: (j: JointMetrics) => string) => (joint ? f(joint) : "—");
  return (
    <Panel title="Joint Metrics" hideHeaderRule>
      <Kpm>
        {variant === "full" && (
          <Row
            term="alpha"
            label="Alpha (ann)"
            value={v(j => pctSigned(j.alpha, 2))}
            bench=""
            accent={joint != null}
          />
        )}
        <Row term="beta" label="Beta" value={v(j => ratio(j.beta))} bench="" />
        <Row term="correlation" label="Correlation" value={v(j => ratio(j.corr))} bench="" />
        <Row term="r_squared" label="R²" value={v(j => ratio(j.r2))} bench="" />
        {variant === "full" && <Row term="information_ratio" label="Information Ratio" value={v(j => ratio(j.info_ratio))} bench="" />}
        <Row term="treynor" label="Treynor" value={v(j => ratio(j.treynor))} bench="" />
        <Row term="tracking_error" label="Tracking Error" value={v(j => pct(j.tracking_error, 2))} bench="" />
        <Row term="up_capture" label="Up Capture" value={v(j => ratio(j.up_capture))} bench="" />
        <Row term="down_capture" label="Down Capture" value={v(j => ratio(j.down_capture))} bench="" />
      </Kpm>
      {withheldReason && (
        <p className="mt-2 text-fixed-11 text-text-muted" data-testid={reasonTestId}>
          {withheldReason}
        </p>
      )}
      {annualizationNote && (
        <p className="mt-2 text-fixed-11 text-text-muted" data-testid="joint-annualization-note">
          {annualizationNote}
        </p>
      )}
    </Panel>
  );
}

function Panel({
  title,
  children,
  benchHeader,
  hideHeaderRule,
  scopeNote,
  term,
}: {
  title: string;
  children: ReactNode;
  benchHeader?: string;
  hideHeaderRule?: boolean;
  /** Phase 201 (D-03): the glossary key when the panel title is a registered term. */
  term?: TermKey;
  /** Phase 169.1 (D-27): "Full history" on a full-history panel while a range is selected. */
  scopeNote?: string;
}) {
  const heading = (
    <h3 className="text-fixed-12 font-semibold uppercase tracking-[0.18em] text-text-primary">
      {term ? <Term k={term}>{title}</Term> : title}
    </h3>
  );
  return (
    <section>
      <header
        className={
          "mb-2 flex items-baseline justify-between " +
          (hideHeaderRule ? "" : "border-b border-border pb-1")
        }
      >
        {scopeNote ? (
          <div className="flex items-baseline gap-2">
            {heading}
            <ScopeNote text={scopeNote} />
          </div>
        ) : (
          heading
        )}
        {benchHeader != null && benchHeader !== "" && (
          <span className="text-fixed-9 font-mono uppercase tracking-[0.18em] text-text-muted">
            vs {benchHeader}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * Phase 196 (D-04): a group sub-heading inside the one Main metrics panel, in the panel
 * sub-heading style the Terms panel's "Fees & Subscription" heading already uses.
 */
function GroupHeading({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return (
    <h4
      className={
        (first ? "" : "mt-4 ") +
        "mb-2 text-fixed-10 font-semibold uppercase tracking-[0.18em] text-text-muted border-b border-border/60 pb-1"
      }
    >
      {children}
    </h4>
  );
}

function Kpm({ children }: { children: ReactNode }) {
  return (
    <table className="w-full text-fixed-12">
      <tbody>{children}</tbody>
    </table>
  );
}

// UI-SPEC §6 (164.6.6.3.3): an `accent` row whose value is "—" renders as plain
// primary text at weight 400, here and in `RollingRow` and the quantile `Kpi`.
function Row({
  label,
  value,
  bench,
  accent,
  windowKey,
  term,
}: {
  label: string;
  value: string;
  bench: string;
  accent?: boolean;
  /** Phase 201 (D-03): the glossary key when the label is a registered term; the label stays the text. */
  term?: TermKey;
  /** Phase 169.1 (D-27): the compute() field of a record-anchored return row. */
  windowKey?: "mtd" | "ytd" | "p3m" | "p6m" | "p1y";
}) {
  return (
    <tr className="border-b border-border/30 last:border-0" data-window-key={windowKey}>
      <td className="py-1.5 pr-2 text-text-2">{term ? <Term k={term}>{label}</Term> : label}</td>
      <td
        className={
          "py-1.5 px-2 text-right font-mono tabular-nums " +
          (accent && value !== "—" ? "text-accent font-medium" : "text-text-primary")
        }
      >
        {value}
      </td>
      <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-text-2">{bench}</td>
    </tr>
  );
}

/** The inline colour of a tone: the token for positive / negative, no style at a rounded zero or a missing value (D-03). */
function toneStyle(tone: "positive" | "negative" | undefined) {
  return tone ? { color: `var(--color-${tone})` } : undefined;
}

function BwRow({ scale, best, worst, dash = false }: { scale: string; best: number; worst: number; dash?: boolean }) {
  // Plan 15: a Withheld row's best / worst period is an extreme over the whole record, printed
  // with no date, so both cells read "—" with no tone (D-15 extended again).
  if (dash) {
    return (
      <tr className="border-b border-border/30 last:border-0">
        <td className="py-1 pr-2 font-mono text-fixed-10 uppercase tracking-[0.14em] text-text-muted">{scale}</td>
        <td className="py-1 px-2 text-right font-mono tabular-nums">—</td>
        <td className="py-1 pl-2 text-right font-mono tabular-nums">—</td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-border/30 last:border-0">
      <td className="py-1 pr-2 font-mono text-fixed-10 uppercase tracking-[0.14em] text-text-muted">
        {scale}
      </td>
      <td
        className="py-1 px-2 text-right font-mono tabular-nums"
        style={toneStyle(signTone(best, 2, 100))}
      >
        {pctSigned(best, 2)}
      </td>
      <td
        className="py-1 pl-2 text-right font-mono tabular-nums"
        style={toneStyle(signTone(worst, 2, 100))}
      >
        {pctSigned(worst, 2)}
      </td>
    </tr>
  );
}

/**
 * 194.2 D-05 (194-ZOOM-BENCHMARK-COVERAGE): on a selected range, the one muted sentence naming the
 * span the benchmark was compared over, when its data starts after the window start or ends before
 * its end. Each side is judged on the benchmark's OWN calendar (`startsAfterCoverage`,
 * `isPastCoverage`), so a weekday benchmark against a weekend window edge is not "short". Null when
 * the benchmark covers the window, when no strategy day in the window has a benchmark return (no
 * span to name: `isoToMonthDay` would print the dash), or when a covered date is not a date (the
 * caller's unreadable sentence has already taken precedence by then). The vs-benchmark figures are
 * untouched: they stay computed on the overlap (D-05 adds no withholding).
 */
function selectedRangeBenchNote(
  benchmarkName: string,
  block: ComparatorBlock,
  scope: RangeScope,
  calendar: WeekdayCalendar,
): string | null {
  const { coveredFrom, coveredThrough } = block;
  if (coveredFrom === undefined || coveredThrough === undefined) return null;
  const from = isoToMonthDay(coveredFrom);
  const through = isoToMonthDay(coveredThrough);
  if (from === "—" || through === "—") return null;
  return benchCoverageNote(benchmarkName, from, through, {
    startsAfter: startsAfterCoverage(coveredFrom, scope.start, calendar),
    endsBefore: comparatorPartialThrough(block.through, scope.end, calendar) !== null,
  });
}

/**
 * Phase 169.5 (SFH-M-05) — the comparator's `through` when its prices stop before
 * the strategy's last date (its figures then cover a shorter span), else null. Null
 * for an unavailable comparator (`through: null`, every figure is already "—"),
 * an absent `through` (a hand-built block, D-21) and full coverage. "Stop before"
 * is read on the comparator's OWN `calendar` through `isPastCoverage`, the rule
 * `buildComparatorBlock`'s `pastThrough` windows and the picker caption use (review
 * round 2 MR-01): SPX through a Friday covers a strategy ending that weekend.
 */
export function comparatorPartialThrough(
  through: string | null | undefined,
  lastDate: string | undefined,
  calendar: WeekdayCalendar,
): string | null {
  if (typeof through !== "string" || lastDate === undefined) return null;
  return isPastCoverage(through, lastDate, calendar) ? through : null;
}

/**
 * Phase 169.5 (SFH-M-05) — the calendar year whose comparator figure is compounded
 * over part of the year only: the year of `through` when a day of the comparator's
 * own `calendar` lies between `through` and the strategy's last date in that same
 * year (`isPastCoverage`, review round 2 MR-01). Null otherwise: SPX through Friday
 * Dec 29 with the strategy's year ending on the weekend is a whole year, and a later
 * year with no covered comparator day already reads "—".
 */
export function comparatorPartialYear(
  through: string | null | undefined,
  dates: readonly string[],
  calendar: WeekdayCalendar,
): string | null {
  if (typeof through !== "string") return null;
  const year = through.slice(0, 4);
  let lastInYear: string | undefined;
  for (const d of dates) {
    if (d.slice(0, 4) === year && (lastInYear === undefined || d > lastInYear)) lastInYear = d;
  }
  return comparatorPartialThrough(through, lastInYear, calendar) != null ? year : null;
}

/**
 * Phase 170 (169-routed item (a), UI-SPEC AD-10) — the label of the month row in
 * Returns and Cumulative Return Metrics. compute()'s `mtd` is the return of the
 * record's LAST month, and `end` is the last RETURN date, not an "ended" marker
 * (the payload has none). So the label goes by how many UTC calendar months
 * that last month lies behind `now` (amended 2026-10-01, review WR-03):
 *   0 (or a future `end`) → "Month-to-date";
 *   1 → `Last month (Sep 2026)`: neutral, because a live strategy reads this way
 *       on the 1st of every month and, on a weekday-only market, over a
 *       month-start weekend;
 *   2+ → `Final month (Jun 2024)`: the record has genuinely stopped.
 * Only the label branches on the clock; the value and 169-05's em-dash lock are
 * unchanged. An empty or unparseable `end` keeps "Month-to-date".
 */
export function monthRowLabel(end: string, now: Date = new Date()): string {
  if (!end) return "Month-to-date";
  const d = new Date(end);
  if (Number.isNaN(d.getTime())) return "Month-to-date";
  const monthsBehind =
    (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
  if (monthsBehind <= 0) return "Month-to-date";
  const named = formatMonth(end);
  return monthsBehind === 1 ? `Last month (${named})` : `Final month (${named})`;
}

/**
 * Phase 169.1 (SC10, D-27) — the data eyebrow naming the range the figures beside
 * it cover: "Full history: <start> – <end>" or "Selected range: <start> – <end>".
 * The KPI strip and the rail both render it from the same `RangeScope` their
 * figures come from, so the label and the numbers cannot describe different spans
 * (T-169-43). DESIGN.md data-eyebrow voice: Geist Mono, uppercase, the 0.18em
 * tracking step, `text-micro`, muted; dates in the rail's own format.
 *
 * Phase 193 (D-03, TRUST-02) — while a range is SELECTED the label carries a
 * one-click "Reset to full history" beside it, on both surfaces. The control
 * calls `resetXRange()` and nothing else (comparator, sections, Y override and
 * toggles stay as the user set them), and it is the ControlBar "Reset view"
 * recipe plus `factsheet-v2-no-print`: the dated label prints, the button does
 * not. A narrowed range is a fact, not an error, so it is never toned red or
 * amber. The button unmounts the moment the range is full, so focus moves to
 * the label (`tabIndex={-1}`) instead of falling to <body> (WCAG 2.4.3). The
 * label text itself stays byte-identical; `className` moved to the wrapping row.
 */
export function RangeEyebrow({
  scope,
  surface,
  className = "",
}: {
  scope: RangeScope;
  surface: "strip" | "rail";
  className?: string;
}) {
  const { resetXRange } = useXRange();
  const labelRef = useRef<HTMLParagraphElement>(null);
  const head = scope.kind === "full" ? "Full history" : "Selected range";
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <p
        ref={labelRef}
        tabIndex={-1}
        data-testid={`range-eyebrow-${surface}`}
        className="font-mono text-micro uppercase tracking-[0.18em] text-text-muted"
      >
        {`${head}: ${isoToMonthDay(scope.start)} – ${isoToMonthDay(scope.end)}`}
      </p>
      {scope.kind === "selected" && (
        <button
          type="button"
          data-testid={`range-reset-${surface}`}
          onClick={() => {
            resetXRange();
            labelRef.current?.focus();
          }}
          className="px-2.5 py-1 text-caption rounded-sm border bg-surface-subtle text-text-2 border-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-[28px] pointer-coarse:min-h-[44px] factsheet-v2-no-print"
        >
          Reset to full history
        </button>
      )}
    </div>
  );
}

/**
 * The factsheet's "Mon D, YYYY" date (UTC); "—" for an empty or unparseable input. Phase 201
 * (D-11): a thin alias of `formatDay`, kept exported because `DistributionPanels`,
 * `ComparatorPicker` and several tests import it by this name.
 */
export function isoToMonthDay(iso: string): string {
  return formatDay(iso);
}

/**
 * Plan 15 (D-15 extended again): the em-dash in place of a whole-record figure when the rail
 * gate (`wholeRecordWithheld`, computed once in `MetricsColumn`) is on, else the formatted figure.
 */
function dashIf(gate: boolean, formatted: string): string {
  return gate ? "—" : formatted;
}

/** A day count; "—" when absent or withheld (a withheld window's NaN, D-27 W1). */
function count(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return String(v);
}

/**
 * Rolling 6-month metrics summarised across the entire warm-window history:
 * current value (the latest window, "—" when it has none), min, max, average. Lets a reader judge
 * how stable each rolling stat has been over the strategy's life.
 */
function RollingMetricsPanel({
  scope,
  wholeRecordWithheld,
  record,
  variant = "full",
}: {
  scope: RangeScope;
  wholeRecordWithheld: boolean;
  /** The rail's TOTAL record (`payload.figureRecord`, read once in `MetricsColumn`). */
  record: FigureRecord | null;
  /**
   * Phase 196 (D-04, UI-SPEC "One small-sample warning"): `"document"` leaves out the muted
   * "annualized from a N-day window, under one year" sentence, the rolling charts' short-track
   * statement, which the KPI strip's note replaces. A withheld window's reason stays: it is the
   * per-figure reason, not a small-sample warning. `"full"` is today's panel.
   */
  variant?: "full" | "document";
}) {
  // Phase 103 (MTM-04 follow-through, Finding B): read the rolling arrays from the
  // basis view — the paired rolling CHARTS already render `view.strategyRolling*`
  // (MTM under the toggle), and the bundle carries the MTM arrays, so the summary
  // table must follow the same basis or it silently reports cash under an MTM chart.
  // The window label rides `view.rollingWindow` so the table's label describes its
  // own (basis-selected) arrays.
  const view = useBasisSeriesView(usePayload());
  // Phase 169.1 (D-27): while a range is selected the table summarises the SAME
  // full-history rolling arrays restricted to the window's indices, so it states
  // exactly the values the rolling charts draw in that window ("Now" is the value
  // at the window's last index).
  const within = (arr: Array<number | null>) =>
    scope.kind === "selected" ? arr.slice(scope.startIdx, scope.endIdx + 1) : arr;
  // Plan 15 (D-15 extended again): Avg, Min and Max aggregate every warm window of the whole
  // record, so on a Withheld row they read "—". Plan 15 review WR-02 (founder 2026-10-15): "Now"
  // is the trailing 6-month window, the span whose 6 Month return the Returns panel already
  // dashes on a Withheld row (a trailing window can straddle the undated break), so it reads
  // "—" too, with no accent (`RollingRow` accents only a figure).
  // Phase 194 (D-11 as superseded by D-15): the payload's own verdict for the table's window
  // (`view.rollingWindow.annualization`, set once by `deriveSeriesBundle`) withholds the same
  // four cells, and ONE muted note says why, or says the window is under a year. Absent, the
  // record is unknown: figures as the payload carries them, no note.
  const verdict = view.rollingWindow?.annualization;
  const stats = (arr: Array<number | null>, dash: boolean) => {
    const r = rollingStats(within(arr));
    return dash ? { ...r, current: null, avg: null, min: null, max: null } : r;
  };
  const dashRows = wholeRecordWithheld || verdict?.state === "withheld";
  const note = variant === "document" && verdict?.state === "short" ? null : rollingVerdictNote(verdict, record);
  // Phase 194 (D-14, ADDITIVE): from 365 days the payload also carries a 365-calendar-day window
  // (`null` under that, so a shorter basis view never shows the cash view's window). It is a
  // SECOND table after the row-window one, never a replacement or a retitle of it. Its own
  // verdict is read the same way, so a record failing the gate dashes it too. A window of a
  // year or more shows plain: it has no note.
  const view1y = view.rollingWindow1y ?? null;
  const vol1y = view.strategyRollingVol1y ?? null;
  const sharpe1y = view.strategyRollingSharpe1y ?? null;
  const sortino1y = view.strategyRollingSortino1y ?? null;
  const dash1y = wholeRecordWithheld || view1y?.annualization?.state === "withheld";
  return (
    <>
      <Panel title={`Rolling Metrics (${view.rollingWindow?.label ?? "6mo"})`}>
        {note && (
          <p className="mb-2 text-fixed-10 italic text-text-muted" data-testid="rolling-annualization-note">
            {note}
          </p>
        )}
        <RollingTable
          v={stats(view.strategyRollingVol, dashRows)}
          sh={stats(view.strategyRollingSharpe, dashRows)}
          so={stats(view.strategyRollingSortino, dashRows)}
        />
      </Panel>
      {view1y != null && vol1y != null && sharpe1y != null && sortino1y != null && (
        <div data-testid="rolling-metrics-1y">
          <Panel title="Rolling Metrics (1y)">
            <RollingTable v={stats(vol1y, dash1y)} sh={stats(sharpe1y, dash1y)} so={stats(sortino1y, dash1y)} />
          </Panel>
        </div>
      )}
    </>
  );
}

/**
 * Phase 194 (D-11, D-15): the one muted line under the row-window table. The `gate` and `record`
 * causes are different sentences from `figure-gate.ts`; a short window names its day count. The
 * `record` sentence reads only a day count, so a blend with no record still gets it from the
 * verdict's own `days`.
 */
function rollingVerdictNote(verdict: RollingVerdict | undefined, record: FigureRecord | null): string | null {
  if (!verdict) return null;
  if (verdict.state === "withheld") {
    if (verdict.cause === "record") {
      return widenedWithheldReason("rolling-record", record ?? { spanDays: verdict.days, observations: null, crypto: false });
    }
    return record ? widenedWithheldReason("rolling", record) : null;
  }
  if (verdict.state === "short" && verdict.days != null) return widenedShortNote("rolling", verdict.days);
  return null;
}

function RollingTable({
  v,
  sh,
  so,
}: {
  v: ReturnType<typeof rollingStats>;
  sh: ReturnType<typeof rollingStats>;
  so: ReturnType<typeof rollingStats>;
}) {
  return (
    <table className="w-full text-fixed-12">
      <thead>
        <tr className="border-b border-border/60">
          <th className="py-1 pr-2 text-left font-mono text-fixed-9 uppercase tracking-[0.18em] text-text-muted">Metric</th>
          <th className="py-1 px-2 text-right font-mono text-fixed-9 uppercase tracking-[0.18em] text-text-muted">Now</th>
          <th className="py-1 px-2 text-right font-mono text-fixed-9 uppercase tracking-[0.18em] text-text-muted">Avg</th>
          <th className="py-1 px-2 text-right font-mono text-fixed-9 uppercase tracking-[0.18em] text-text-muted">Min</th>
          <th className="py-1 pl-2 text-right font-mono text-fixed-9 uppercase tracking-[0.18em] text-text-muted">Max</th>
        </tr>
      </thead>
      <tbody>
        <RollingRow term="volatility" label="Volatility" fmt="pct" stats={v} />
        <RollingRow term="sharpe" label="Sharpe" fmt="num" stats={sh} accent />
        <RollingRow term="sortino" label="Sortino" fmt="num" stats={so} />
      </tbody>
    </table>
  );
}

function RollingRow({
  label,
  fmt,
  stats,
  accent,
  term,
}: {
  label: string;
  fmt: "pct" | "num";
  stats: ReturnType<typeof rollingStats>;
  accent?: boolean;
  /** Phase 201 (D-03): the glossary key of a registered label. */
  term?: TermKey;
}) {
  const f = (v: number | null) => (fmt === "pct" ? pct(v, 1) : ratio(v));
  return (
    <tr className="border-b border-border/30 last:border-0">
      <td className="py-1 pr-2 text-text-2">{term ? <Term k={term}>{label}</Term> : label}</td>
      <td className={"py-1 px-2 text-right font-mono tabular-nums " + (accent && f(stats.current) !== "—" ? "text-accent font-medium" : "text-text-primary")}>
        {f(stats.current)}
      </td>
      <td className="py-1 px-2 text-right font-mono tabular-nums text-text-2">{f(stats.avg)}</td>
      <td className="py-1 px-2 text-right font-mono tabular-nums text-text-2">{f(stats.min)}</td>
      <td className="py-1 pl-2 text-right font-mono tabular-nums text-text-2">{f(stats.max)}</td>
    </tr>
  );
}

/**
 * Cumulative return at every standard reporting period — MTD / 3M / 6M / YTD /
 * 1Y / 3Y / 5Y / inception. Distinct from the "Returns" panel (which is the
 * trailing-window snapshot); this one walks every period for skim-readers.
 */
function CumulativeReturnsPanel({ figureState }: { figureState: FigureState }) {
  // Phase 103 (MTM-04, root-cause flip): the WHOLE panel follows the active basis.
  // Every row is a calendar window from compute() on the active basis, read from
  // the VIEW's strategyMetrics (the bundle's compute() on the MTM series under
  // mark_to_market; `payload` by reference under cash), and a multi-year row
  // exists only when the record covers its window (compute() reports it null).
  // Phase 169 D-17, 2026-09-25: 3 Year / 5 Year rows are omitted, not em-dashed, when the window is absent or null; SC6 read literally.
  // Phase 169 D-57, 2026-09-27: 6 Month / 1 Year rows are omitted when the record is shorter, in this panel and in Returns, on every mount including the scenario payload; YTD is a calendar window and keeps the em-dash (D-11).
  // 164.6.6.3.3 UI-SPEC 1.6 (B20, D-12): the omission follows the RECORD's length (`recordCoversWindow`), not the value, so a covered window whose suffix value is null reads "—"; 3 Year / 5 Year keep the null rule above.
  const payload = usePayload();
  const view = useBasisSeriesView(payload);
  const m = view.strategyMetrics;
  const covers6m = recordCoversWindow(view.dates, 182);
  const covers1y = recordCoversWindow(view.dates, 365);
  // Phase 169 review round 1 (SFH H-1): Since Inception and CAGR are the stored
  // headline on a chain-broken row, so the panel says which span they cover.
  // Phase 164.6.6.3.3 (UI-SPEC 1.3 S5, B17): every return in this panel is on the
  // suffix, so the label is muted with no warning glyph; a Withheld row shows no label
  // here (the Main Metrics note speaks). Since Inception and CAGR read "—" from the
  // withheld stored scalars, and the trailing windows read "—" because the build
  // nulls them on a Withheld row (WR-01, `withSuffixWindows`).
  const spanNote = headlineCoverageNote(payload.dataQuality, useBasisOrCash(), "cumulative");
  // Inception return = cum_ret (no need to recompute).
  return (
    <Panel title="Cumulative Return Metrics">
      {spanNote && <p className="mb-2 text-fixed-10 italic text-text-muted">{spanNote.text}</p>}
      <Kpm>
        <Row label={monthRowLabel(m.end)} value={pctSigned(m.mtd, 2)} bench="" />
        <Row label="3 Month" value={pctSigned(m.p3m, 2)} bench="" />
        {(m.p6m != null || covers6m) && <Row label="6 Month" value={pctSigned(m.p6m, 2)} bench="" />}
        <Row label="Year-to-date" value={pctSigned(m.ytd, 2)} bench="" />
        {(m.p1y != null || covers1y) && <Row label="1 Year" value={pctSigned(m.p1y, 2)} bench="" />}
        {m.p3y != null && <Row label="3 Year" value={pctSigned(m.p3y, 2)} bench="" />}
        {m.p5y != null && <Row label="5 Year" value={pctSigned(m.p5y, 2)} bench="" />}
        <Row label="Since Inception" value={pctSigned(m.cum_ret, 2)} bench="" accent />
        {/* Phase 194 (D-04 as superseded by D-15): the one rail CAGR plan 04 did not route. */}
        <Row term="cagr" label="CAGR" value={pctSigned(gatedValue(m.cagr, figureState), 2)} bench="" />
      </Kpm>
    </Panel>
  );
}

/**
 * Extended risk-and-distribution metrics. Collects the secondary diagnostics
 * scattered across the headline panels so a reader can scan tail behaviour in
 * one place: skew, kurtosis, VaR/CVaR, win/loss asymmetry, profit factor.
 */
function ExtendedMetricsPanel({
  wholeRecordWithheld,
  variant = "full",
}: {
  wholeRecordWithheld: boolean;
  /**
   * Phase 196 (D-04): `"document"` drops every row another surface owns (Skew, Kurtosis, VaR,
   * CVaR, Profit Factor: the Main metrics table; P5, P95, Median: the distribution box) and the
   * VaR method line that went with VaR. `"full"` is today's panel.
   */
  variant?: "full" | "document";
}) {
  const full = variant === "full";
  // Phase 103 (MTM-04 follow-through, Finding A): the quantile rows (P5/P95/Median)
  // AND the extended distribution scalars (skew/kurtosis/VaR/CVaR/omega/profit-
  // factor/pain/ulcer/…) are pure functions of the daily series, so they all follow
  // the active basis — `view.strategyMetrics` is now the bundle's series-recomputed
  // scalar cache under MTM (the seven persisted HEADLINE scalars stay KpiStrip-owned).
  // Phase 169.1 (D-27): the windowed view, so the quantile rows and the extended
  // scalars describe the selected range (the active view by reference at full history).
  const { view } = useWindowedView(usePayload());
  const m = view.strategyMetrics;
  const q = view.quantiles;
  // Tail Ratio is LABELLED "P95/|P5|", so it must equal exactly that ratio of the
  // SAME (basis-selected) quantile rows shown below — deriving it from `q` closes the
  // checkable arithmetic contradiction (the old `m.tail_ratio` used a floor-index
  // percentile that disagreed with the interpolated P5/P95 rows). Common-sense ratio
  // (tail × profit-factor) rides the same derived tail so the panel stays internally
  // consistent under both bases.
  const tailRatio = q.p05 < 0 ? Math.abs(q.p95 / q.p05) : null;
  const commonSenseRatio = tailRatio != null ? tailRatio * m.profit_factor : null;
  // Plan 15 (D-15 extended again): every row here is a distribution or drawdown scalar over the
  // whole record, so a Withheld row prints "—" for all fifteen. `Row` drops the accent on a dash.
  const wr = (formatted: string) => dashIf(wholeRecordWithheld, formatted);
  return (
    <Panel title="Extended Metrics">
      <Kpm>
        {full && (
          <>
            <Row term="skew" label="Skew" value={wr(signed(m.skew))} bench="" />
            <Row term="kurtosis" label="Kurtosis (excess)" value={wr(ratio(m.kurt))} bench="" accent={m.kurt > 6} />
            <Row term="var_95" label="VaR 95%" value={wr(pctSigned(m.var95, 2))} bench="" />
            <Row term="cvar_95" label="CVaR 95%" value={wr(pctSigned(m.cvar95, 2))} bench="" />
            <Row term="percentile" label="P5 (daily)" value={wr(pctSigned(q.p05, 2))} bench="" />
            <Row term="percentile" label="P95 (daily)" value={wr(pctSigned(q.p95, 2))} bench="" />
            <Row label="Median (daily)" value={wr(pctSigned(q.p50, 2))} bench="" />
            <Row term="profit_factor" label="Profit Factor" value={wr(ratio(m.profit_factor))} bench="" />
          </>
        )}
        <Row term="omega" label="Omega (θ=0)" value={wr(ratio(m.omega_ratio))} bench="" />
        <Row term="tail_ratio" label="Tail Ratio (P95/|P5|)" value={wr(ratio(tailRatio))} bench="" />
        <Row term="common_sense_ratio" label="Common-sense Ratio" value={wr(ratio(commonSenseRatio))} bench="" />
        <Row term="recovery_factor" label="Recovery Factor" value={wr(ratio(m.recovery_factor))} bench="" accent={m.recovery_factor != null && m.recovery_factor >= 3} />
        <Row term="pain_index" label="Pain Index" value={wr(pct(m.pain_index, 2))} bench="" />
        <Row term="ulcer_index" label="Ulcer Index" value={wr(pct(m.ulcer_index, 2))} bench="" />
        <Row term="avg_win_loss" label="Avg Win / Avg Loss" value={wr(ratioStr(m.avg_win, m.avg_loss))} bench="" />
      </Kpm>
      {full && <p className="mt-2 text-fixed-10 italic text-text-muted" data-testid="var-method-line">{VAR_METHOD_LINE}</p>}
    </Panel>
  );
}

function rollingStats(arr: Array<number | null>): {
  current: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
} {
  // "Now" is the CURRENT window: the last element, "—" when it has no value.
  // Phase 166.2 SFH-R2-H1: under D7 a flat trailing window is null, and walking
  // back to the last non-null value would print a months-old window as current.
  const last = arr.length > 0 ? arr[arr.length - 1] : null;
  const current = last != null && Number.isFinite(last) ? last : null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    count++;
  }
  if (count === 0) return { current: null, min: null, max: null, avg: null };
  return { current, min, max, avg: sum / count };
}

function ratioStr(win: number, loss: number): string {
  if (!Number.isFinite(win) || !Number.isFinite(loss) || loss === 0) return "—";
  return `${(win / Math.abs(loss)).toFixed(2)}×`;
}

/**
 * Worst-N drawdowns as a compact ranked table. The same periods are shaded on
 * the Worst-10 Drawdown Periods chart; this gives readers exact peak/trough/
 * recovery dates plus depth and three duration columns (peak→trough,
 * trough→recovery, total). Indices map to dates via payload.dates.
 */
function WorstDrawdownsTablePanel() {
  // Phase 103 (MTM-04): the worst-10 table follows the active basis so it stays
  // coherent with the Worst-DDs chart bands. Its indices are into the ACTIVE date
  // axis, so BOTH strategyWorst10 AND dates must come from the view (an MTM index
  // mapped onto the cash calendar would mislabel peak/trough/recovery dates).
  // Phase 169.1 (D-27): the windowed view, whose Worst 10 indices are into its own
  // (window) dates, so only drawdowns inside the range are listed.
  const { view } = useWindowedView(usePayload());
  const rows = view.strategyWorst10;
  if (rows.length === 0) return null;
  return (
    <Panel title="Worst 10 Drawdowns">
      {/* 54-01b: no --text-fixed-10.5 token exists (54-01a added integer-px
          aliases only; this plan must not touch globals.css). 10.5px = 0.65625rem
          exactly, so the rem arbitrary value is byte-identical AND clears
          no-raw-font-px (which matches px-units only). */}
      <ResponsiveTable label="Worst 10 drawdowns">
      <table className="w-full text-[0.65625rem]">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-1 text-right font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted">#</th>
            <th className="py-1 px-1 text-left font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted whitespace-nowrap">Peak</th>
            <th className="py-1 px-1 text-left font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted whitespace-nowrap">Trough</th>
            <th className="py-1 px-1 text-left font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted whitespace-nowrap">Recov.</th>
            <th className="py-1 px-1 text-right font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted whitespace-nowrap">Depth</th>
            <th
              className="py-1 px-1 text-right font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted whitespace-nowrap"
              title="Days from peak to trough"
            >
              DD d
            </th>
            <th
              className="py-1 px-1 text-right font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted whitespace-nowrap"
              title="Days from trough to recovery"
            >
              Rec d
            </th>
            <th
              className="py-1 pl-1 text-right font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted whitespace-nowrap"
              title="Total period peak to recovery"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const ddDays = r.trough - r.start;
            const recDays = r.recover - r.trough;
            const total = r.recover - r.start;
            return (
              <tr key={i} className="border-b border-border/30 last:border-0">
                <td className="py-1 pr-1 text-right font-mono tabular-nums text-text-2">#{i + 1}</td>
                <td className="py-1 px-1 font-mono whitespace-nowrap text-text-2">{formatDay(view.dates[r.start])}</td>
                <td className="py-1 px-1 font-mono whitespace-nowrap text-text-2">{formatDay(view.dates[r.trough])}</td>
                <td className="py-1 px-1 font-mono whitespace-nowrap text-text-2">{formatDay(view.dates[r.recover])}</td>
                <td className="py-1 px-1 text-right font-mono tabular-nums" style={toneStyle(drawdownTone(r.depth, 2, 100))}>
                  {pct(r.depth, 2)}
                </td>
                <td className="py-1 px-1 text-right font-mono tabular-nums text-text-primary">{ddDays}d</td>
                <td className="py-1 px-1 text-right font-mono tabular-nums text-text-primary">{recDays}d</td>
                <td className="py-1 pl-1 text-right font-mono tabular-nums text-text-2">{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </ResponsiveTable>
    </Panel>
  );
}

/**
 * EOY Returns table: per-year strategy return + active comparator return + Δ.
 * Comparator-reactive — picker swap re-renders the right two columns.
 * Falls back to a strategy-only single column when comparator = NONE.
 */
function EoyReturnsPanel({ scopeNote, fullHistoryWithheld }: { scopeNote?: string; fullHistoryWithheld: boolean }) {
  // Phase 103 (MTM-04, root-cause flip): the EOY table follows the active basis to
  // match the rest of the rail (and the EOY bar chart in DistributionPanels). Both
  // the strategy per-year (`view.strategyMetrics.yearly`) and the comparator daily
  // series (`cmp.dailyReturns` compounded on the VIEW's own date axis) come from the
  // view, so strategy + benchmark sit on ONE coherent basis. Under cash the view
  // returns `payload` by reference (byte-identical).
  const payload = usePayload();
  const view = useBasisSeriesView(payload);
  const { key: cmpKey } = useActiveComparator();
  const cmp = view.comparators[cmpKey];
  const stratYearly = view.strategyMetrics.yearly;
  const benchYearly: Record<string, number> = {};
  if (cmpKey !== "none" && Array.isArray(cmp.dailyReturns)) {
    for (let i = 0; i < view.dates.length; i++) {
      const r = cmp.dailyReturns[i];
      if (r == null || !Number.isFinite(r)) continue;
      const yr = view.dates[i].slice(0, 4);
      benchYearly[yr] = benchYearly[yr] == null ? r : (1 + benchYearly[yr]) * (1 + r) - 1;
    }
  }
  const hasBench = cmpKey !== "none";
  const years = Array.from(new Set([...Object.keys(stratYearly), ...Object.keys(benchYearly)])).sort();
  // Plan 15 review WR-01 (founder 2026-10-15): the record's last calendar year is built by
  // `compute()` from the same dates as the Year-to-date return, which the Returns panel dashes
  // on a Withheld row (the benchmark's too). On that row the last year's strategy, benchmark and
  // delta cells read "—" with no tone; every earlier year covers its own calendar year and stays.
  const lastYear = view.dates.length > 0 ? view.dates[view.dates.length - 1].slice(0, 4) : null;
  // SFH-M-05 (keeps D-54): the year whose comparator cell covers part of it only.
  const partialYear = hasBench ? comparatorPartialYear(cmp.through, view.dates, COMPARATOR_CALENDARS[cmpKey]) : null;
  if (years.length === 0) return null;
  return (
    <Panel title={withUnit("EOY Returns", payload.returnsUnit ?? null)} benchHeader={hasBench ? cmp.shortName : undefined} scopeNote={scopeNote}>
      <table className="w-full text-fixed-11">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-2 text-left font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted">Year</th>
            <th className="py-1 px-2 text-right font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted">Strategy</th>
            {hasBench && (
              <>
                <th className="py-1 px-2 text-right font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted">
                  {cmp.shortName}
                </th>
                <th className="py-1 pl-2 text-right font-mono text-fixed-9 uppercase tracking-[0.14em] text-text-muted">Δ</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {years.map(year => {
            const dashed = fullHistoryWithheld && year === lastYear;
            const s = dashed ? undefined : stratYearly[year];
            const b = hasBench && !dashed ? benchYearly[year] : undefined;
            const delta = s != null && b != null ? s - b : null;
            return (
              <tr key={year} className="border-b border-border/30 last:border-0">
                <td className="py-1 pr-2 font-mono tabular-nums text-text-2">{year}</td>
                <td
                  className="py-1 px-2 text-right font-mono tabular-nums"
                  style={toneStyle(signTone(s, 2, 100))}
                >
                  {pctSigned(s, 2)}
                </td>
                {hasBench && (
                  <>
                    <td
                      className="py-1 px-2 text-right font-mono tabular-nums"
                      style={toneStyle(signTone(b, 2, 100))}
                    >
                      {pctSigned(b, 2)}
                    </td>
                    <td
                      className="py-1 pl-2 text-right font-mono tabular-nums"
                      style={toneStyle(signTone(delta, 1, 100))}
                    >
                      {ppDelta(s, b, 1)}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {partialYear != null && typeof cmp.through === "string" && (
        <p className="mt-1 text-fixed-10 italic text-text-muted">
          {cmp.shortName} {partialYear}: prices through {isoToMonthDay(cmp.through)} only.
        </p>
      )}
    </Panel>
  );
}
