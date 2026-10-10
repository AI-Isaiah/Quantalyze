"use client";

import type { ReactNode } from "react";
import { ResponsiveTable } from "@/components/ResponsiveTable";
import type { ComparatorBlock, ComparatorSummary, FactsheetPayload, JointMetrics } from "@/lib/factsheet/types";
import { formatRecordLength } from "@/lib/factsheet/record-length";
import { recordCoversWindow } from "@/lib/factsheet/compute";
import { COMPARATOR_CALENDARS, isPastCoverage, type WeekdayCalendar } from "@/lib/factsheet/align";
import { flatLegReason, pairedFloorReason } from "@/lib/factsheet/joint";
import { joinGuardPhrases } from "@/lib/factsheet/headline-basis";
import { benchmarkWithheldReason, nativeUnitReason, withUnit } from "@/lib/factsheet/returns-unit";
import { usePayload, useActiveComparator } from "./factsheet-context";
import { useBasisOrCash, useBasisSeriesView, useWindowedView, type Basis, type RangeScope } from "./basis-context";
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

export function headlineCoverageNote(
  dataQuality: FactsheetPayload["dataQuality"],
  basis: Basis,
  slot: HeadlineNoteSlot,
  opts: { benchShown?: boolean } = {},
): HeadlineNote | null {
  if (basis !== "cash_settlement") return null;
  if (dataQuality?.twrChainBroken !== true) return null;
  const reasons = joinGuardPhrases(dataQuality.headlineGuardReasons ?? []);
  if (dataQuality.headlineWithheld === true) {
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
function headlineBenchSource(
  dataQuality: FactsheetPayload["dataQuality"],
  basis: Basis,
  selected: boolean,
  block: ComparatorBlock,
): ComparatorSummary | null {
  if (selected || basis !== "cash_settlement" || dataQuality?.twrChainBroken !== true) return block.summary;
  if (dataQuality.headlineWithheld === true) return null;
  return block.summarySince !== undefined ? block.summarySince : block.summary;
}

/**
 * Editorial right-column metrics. Four named sections — Performance, Risk,
 * Style, Benchmark — each introduced by a serif-italic eyebrow over a thick
 * hairline divider, then a stack of dense KPM tables.
 *
 * No card chrome between sub-panels: hairline section dividers carry the
 * structure, matching DESIGN.md's "data density > card density" rule and
 * the FactSet quarterly-factsheet reference.
 */
export function MetricsColumn({ scenarioMode = false }: { scenarioMode?: boolean }) {
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
  // Phase 167.1.2 plan 07 (SC-5b) — observations per year for the Main Metrics
  // warning, read from the payload this rail already renders. Absent (a stale
  // cache) or not a positive finite number → undefined, and the warning hides.
  const obsPerYear =
    typeof payload.periodsPerYear === "number" &&
    Number.isFinite(payload.periodsPerYear) &&
    payload.periodsPerYear > 0
      ? payload.periodsPerYear
      : undefined;
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

  return (
    <aside className="flex flex-col gap-12">
      <StrategyThesisPanel />
      {/* Phase 169.1 (D-27): the range the rail's figures cover, as on the strip. */}
      <RangeEyebrow scope={scope} surface="rail" />
      <EditorialSection label="I" name="Performance">
        <Panel title="Compound Performance">
          <Kpm>
            <Row label="Start Date" value={isoToMonthDay(m.start)} bench="" />
            <Row label="End Date" value={isoToMonthDay(m.end)} bench="" />
            <Row label="Years Observed" value={recordLength.years} bench="" />
          </Kpm>
        </Panel>
        <Panel title="Main Metrics" benchHeader={bnDated}>
          {/* Phase 167.1.2 plan 07 (SC-5b): one year is the payload's own
              annualisation basis (365 crypto / the book's blend basis), not a
              fixed trading-day count. A payload with no basis shows no warning:
              assuming one is the defect this replaced. The basis sets only the
              threshold; the stated length is calendar years (Phase 169 D-12,
              D-51). */}
          {obsPerYear != null && m.n < obsPerYear && (
            <p className="mb-2 text-fixed-10 italic" style={{ color: "var(--color-warning, #B45309)" }}>
              ⚠ Only {m.n} observations ({recordLength.years}y) — Sharpe / Sortino / Calmar below
              have wide statistical confidence intervals. Conventional reliability threshold is
              ≥ {obsPerYear} observations (1 year).
            </p>
          )}
          {spanNote && (
            <p className="mb-2 text-fixed-10 italic" style={{ color: headlineNoteColor(spanNote.variant) }}>
              {headlineNoteGlyph(spanNote.variant)}
              {spanNote.text}
            </p>
          )}
          <Kpm>
            <Row label={withUnit("Cumulative Return", payload.returnsUnit ?? null)} value={pct(m.cum_ret, true)} bench={pct(hb?.cum_ret, true)} />
            <Row label={withUnit("CAGR", payload.returnsUnit ?? null)} value={pct(m.cagr, true)} bench={pct(hb?.cagr, true)} />
            <Row label="Ann. Volatility" value={pct(m.ann_vol)} bench={pct(hb?.ann_vol)} />
            <Row label="Sharpe" value={num(m.sharpe)} bench={num(hb?.sharpe)} accent />
            <Row label="Sortino" value={num(m.sortino)} bench={num(hb?.sortino)} />
            <Row label="Calmar" value={num(m.calmar)} bench={num(hb?.calmar)} />
            <Row label="Skew" value={signed(m.skew)} bench="" />
            <Row label="Kurtosis" value={num(m.kurt)} bench="" />
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
                <Row windowKey="mtd" label={monthRowLabel(m.end)} value={pct(m.mtd, true)} bench={pct(hb?.mtd, true)} />
                <Row windowKey="ytd" label="Year-to-date" value={pct(m.ytd, true)} bench={pct(hb?.ytd, true)} />
                <Row windowKey="p3m" label="3 Month" value={pct(m.p3m, true)} bench={pct(hb?.p3m, true)} />
                {(m.p6m != null || covers6m) && <Row windowKey="p6m" label="6 Month" value={pct(m.p6m, true)} bench={pct(hb?.p6m, true)} />}
                {(m.p1y != null || covers1y) && <Row windowKey="p1y" label="1 Year" value={pct(m.p1y, true)} bench={pct(hb?.p1y, true)} />}
              </>
            )}
            <Row label="Win Rate (days)" value={pct(m.win_rate)} bench={pct(b?.win_rate)} />
            <Row label="Profit Factor" value={num(m.profit_factor)} bench={num(b?.profit_factor)} />
          </Kpm>
        </Panel>
        <EoyReturnsPanel scopeNote={selected ? FULL_HISTORY_NOTE : undefined} />
        <RollingMetricsPanel scope={scope} />
        {!selected && <CumulativeReturnsPanel />}
      </EditorialSection>

      <EditorialSection label="II" name="Risk">
        {/* SFH-M-05: this panel carries no bench header at full coverage; it gains
            the dated one only when the comparator's figures stop early. */}
        <Panel title="Max Drawdown" benchHeader={benchThrough != null ? bnDated : undefined}>
          {maxDdSpan && <p className="mb-2 text-fixed-10 italic text-text-muted">{maxDdSpan.text}</p>}
          <Kpm>
            <Row label="Max Drawdown" value={pctNeg(m.max_dd)} bench={pctNeg(hb?.max_dd)} accent />
            <Row label="Longest DD (days)" value={count(m.longest_dd)} bench={count(b?.longest_dd)} />
            <Row label="VaR 95%" value={pct(m.var95, true)} bench="" />
            <Row label="CVaR 95%" value={pct(m.cvar95, true)} bench="" />
            <Row label="Avg Win" value={pct(m.avg_win, true)} bench="" />
            <Row label="Avg Loss" value={pct(m.avg_loss, true)} bench="" />
          </Kpm>
        </Panel>
        <BootstrapCIPanel />
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
              <BwRow scale="Day" best={m.best_day} worst={m.worst_day} />
              <BwRow scale="Week" best={m.best_week} worst={m.worst_week} />
              <BwRow scale="Month" best={m.best_month} worst={m.worst_month} />
              <BwRow scale="Quarter" best={m.best_quarter} worst={m.worst_quarter} />
              <BwRow scale="Year" best={m.best_year} worst={m.worst_year} />
            </tbody>
          </table>
        </Panel>
        <CalmarByYearPanel />
        <WorstDrawdownsTablePanel />
        <ExtendedMetricsPanel />
      </EditorialSection>

      <EditorialSection label="III" name="Style" scopeNote={selected ? FULL_HISTORY_NOTE : undefined}>
        <StyleDriftPanel />
        {/* PeerPercentile renders for api strategies (demo/synthesized cohort)
            OR — Phase 42 (PEER-01, ADR-0025) — for the scenario BLEND, which
            carries an additive `scenarioPeer` ranked vs the REAL verified
            universe (never an ingestSource flip; the three genuinely-synthetic
            panels stay structurally absent). The explicit `ingestSource ===
            "csv"` narrow is required before reading the csv-only `scenarioPeer`
            field (Pitfall 3 — mirrors the B6 narrowing discipline). With
            scenarioMode=false (every existing call site) the second disjunct is
            dead and the api path is byte-identical. (NEW-C20-01) */}
        {(payload.ingestSource === "api" ||
          (scenarioMode &&
            payload.ingestSource === "csv" &&
            payload.scenarioPeer != null)) && <PeerPercentilePanel />}
        {/* Phase 42 (PEER-05): the blend-vs-live-book signed delta, AFTER the
            peer panel (UI-SPEC §III). scenarioMode-gated here — the panel ALSO
            null-guards on its csv-only `scenarioOwnBookDelta` carve-out (silently
            absent without a live book), so non-scenario factsheets are
            byte-identical. */}
        {scenarioMode && <OwnBookDeltaPanel />}
      </EditorialSection>

      <EditorialSection label="V" name="Terms">
        {/* Phase 42 (PEER-04): per-constituent mandate chips for the scenario
            BLEND, BEFORE TermsPanel (UI-SPEC §V). scenarioMode-gated here — the
            panel ALSO null-guards on its csv-only `scenarioMandate` carve-out, so
            on every existing (non-scenario) call site it renders nothing and §V
            stays byte-identical. */}
        {scenarioMode && <ConstituentMandatePanel />}
        <LeverageProfilePanel />
        <TermsPanel />
      </EditorialSection>

      {payload.returnsUnit && cmpKey === "none" ? (
        // Phase 164.6.6.2 (D-10, UI-SPEC A15): a strategy whose returns are in a native
        // unit has no BTC benchmark (measured in BTC it is a flat line; the USD-priced
        // one mixes units), so §IV stays, every row reads "—", and one line says why
        // ("show null with the reason"). With SPX active the arms below render as today.
        <EditorialSection label="IV" name="Benchmark — vs BTC">
          <BenchmarkMetricsBody
            joint={null}
            withheldReason={
              // Phase 164.6.6.2.1 (D-15): the USD view's returns were CONVERTED, so the
              // native view's "flat line" sentence is false there; it says why in its own words.
              payload.convertedFrom != null
                ? `Not measurable: ${benchmarkWithheldReason(payload.returnsUnit, payload.convertedFrom)}, so they carry the ${payload.convertedFrom} price by construction.`
                : `Not measurable: ${benchmarkWithheldReason(payload.returnsUnit)}. A BTC benchmark measured in ${payload.returnsUnit} is a flat line.`
            }
          />
        </EditorialSection>
      ) : jointCmp.joint ? (
        <EditorialSection label="IV" name={`Benchmark — vs ${bn}`}>
          {/* Phase 164.6.6.3.3 (D-04, UI-SPEC 2.2): a flat strategy leg's joint carries NaN for
              alpha, beta, IR and the captures ("—") and the block's `flatLeg` marker picks the
              one muted reason line. The marker, never the NaN values, selects it. */}
          <BenchmarkMetricsBody
            joint={jointCmp.joint}
            withheldReason={jointCmp.flatLeg ? flatLegReason(selected ? "range" : "record") : undefined}
            reasonTestId="joint-flat-leg-reason"
          />
        </EditorialSection>
      ) : jointCmp.jointWithheld && bn != null ? (
        // 169.4 review round 2 (SFH-R2 MEDIUM-2): below the paired floor §IV
        // stays, every joint figure reads "—" and one muted line names the
        // cause in the Allocations widget's words. No figure is shown (D-69).
        <EditorialSection label="IV" name={`Benchmark — vs ${bn}`}>
          <BenchmarkMetricsBody
            joint={null}
            withheldReason={pairedFloorReason(
              bn,
              jointCmp.jointWithheld.paired,
              // D-85: inside a window the count is the slice's, named as the range's.
              selected ? "range" : "record",
              jointCmp.jointWithheld.floor,
            )}
          />
        </EditorialSection>
      ) : null}
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

function BenchmarkMetricsBody({
  joint,
  withheldReason,
  reasonTestId = "joint-floor-reason",
}: {
  joint: JointMetrics | null;
  withheldReason?: string;
  /** `joint-floor-reason` for the native-unit and paired-floor arms; the flat-leg arm passes its own. */
  reasonTestId?: "joint-floor-reason" | "joint-flat-leg-reason";
}) {
  // A null joint (withheld below the paired floor) reads "—" in every row.
  // The dash-never-accent rule (UI-SPEC §6) lives in `Row` itself, so the alpha
  // dash is plain text whatever `accent` says.
  const v = (f: (j: JointMetrics) => string) => (joint ? f(joint) : "—");
  return (
    <Panel title="Joint Metrics" hideHeaderRule>
      <Kpm>
        <Row label="Alpha (ann)" value={v(j => pct(j.alpha, true))} bench="" accent={joint != null} />
        <Row label="Beta" value={v(j => num(j.beta))} bench="" />
        <Row label="Correlation" value={v(j => num(j.corr))} bench="" />
        <Row label="R²" value={v(j => num(j.r2))} bench="" />
        <Row label="Information Ratio" value={v(j => num(j.info_ratio))} bench="" />
        <Row label="Treynor" value={v(j => num(j.treynor))} bench="" />
        <Row label="Tracking Error" value={v(j => pct(j.tracking_error))} bench="" />
        <Row label="Up Capture" value={v(j => num(j.up_capture))} bench="" />
        <Row label="Down Capture" value={v(j => num(j.down_capture))} bench="" />
      </Kpm>
      {withheldReason && (
        <p className="mt-2 text-fixed-11 text-text-muted" data-testid={reasonTestId}>
          {withheldReason}
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
}: {
  title: string;
  children: ReactNode;
  benchHeader?: string;
  hideHeaderRule?: boolean;
  /** Phase 169.1 (D-27): "Full history" on a full-history panel while a range is selected. */
  scopeNote?: string;
}) {
  const heading = (
    <h3 className="text-fixed-12 font-semibold uppercase tracking-[0.18em] text-text-primary">
      {title}
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
}: {
  label: string;
  value: string;
  bench: string;
  accent?: boolean;
  /** Phase 169.1 (D-27): the compute() field of a record-anchored return row. */
  windowKey?: "mtd" | "ytd" | "p3m" | "p6m" | "p1y";
}) {
  return (
    <tr className="border-b border-border/30 last:border-0" data-window-key={windowKey}>
      <td className="py-1.5 pr-2 text-text-2">{label}</td>
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

function BwRow({ scale, best, worst }: { scale: string; best: number; worst: number }) {
  return (
    <tr className="border-b border-border/30 last:border-0">
      <td className="py-1 pr-2 font-mono text-fixed-10 uppercase tracking-[0.14em] text-text-muted">
        {scale}
      </td>
      <td
        className="py-1 px-2 text-right font-mono tabular-nums"
        style={{ color: "var(--color-positive)" }}
      >
        {pct(best, true)}
      </td>
      <td
        className="py-1 pl-2 text-right font-mono tabular-nums"
        style={{ color: "var(--color-negative)" }}
      >
        {pct(worst, true)}
      </td>
    </tr>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The factsheet's "Mon D, YYYY" date (UTC); "—" for an empty or unparseable input. */
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
  const named = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return monthsBehind === 1 ? `Last month (${named})` : `Final month (${named})`;
}

/**
 * Phase 169.1 (SC10, D-27) — the data eyebrow naming the range the figures beside
 * it cover: "Full history: <start> – <end>" or "Selected range: <start> – <end>".
 * The KPI strip and the rail both render it from the same `RangeScope` their
 * figures come from, so the label and the numbers cannot describe different spans
 * (T-169-43). DESIGN.md data-eyebrow voice: Geist Mono, uppercase, the 0.18em
 * tracking step, `text-micro`, muted; dates in the rail's own format.
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
  const head = scope.kind === "full" ? "Full history" : "Selected range";
  return (
    <p
      data-testid={`range-eyebrow-${surface}`}
      className={`font-mono text-micro uppercase tracking-[0.18em] text-text-muted ${className}`}
    >
      {`${head}: ${isoToMonthDay(scope.start)} – ${isoToMonthDay(scope.end)}`}
    </p>
  );
}

export function isoToMonthDay(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function pct(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const x = v * 100;
  const sign = signed ? (x >= 0 ? "+" : "") : "";
  return `${sign}${x.toFixed(2)}%`;
}

function pctNeg(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function signed(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}

function num(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
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
function RollingMetricsPanel({ scope }: { scope: RangeScope }) {
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
  const v = rollingStats(within(view.strategyRollingVol));
  const sh = rollingStats(within(view.strategyRollingSharpe));
  const so = rollingStats(within(view.strategyRollingSortino));
  return (
    <Panel title={`Rolling Metrics (${view.rollingWindow?.label ?? "6mo"})`}>
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
          <RollingRow label="Volatility" fmt="pct" stats={v} />
          <RollingRow label="Sharpe" fmt="num" stats={sh} accent />
          <RollingRow label="Sortino" fmt="num" stats={so} />
        </tbody>
      </table>
    </Panel>
  );
}

function RollingRow({
  label,
  fmt,
  stats,
  accent,
}: {
  label: string;
  fmt: "pct" | "num";
  stats: ReturnType<typeof rollingStats>;
  accent?: boolean;
}) {
  const f = (v: number | null) => (v == null ? "—" : fmt === "pct" ? `${(v * 100).toFixed(1)}%` : v.toFixed(2));
  return (
    <tr className="border-b border-border/30 last:border-0">
      <td className="py-1 pr-2 text-text-2">{label}</td>
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
function CumulativeReturnsPanel() {
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
        <Row label={monthRowLabel(m.end)} value={pct(m.mtd, true)} bench="" />
        <Row label="3 Month" value={pct(m.p3m, true)} bench="" />
        {(m.p6m != null || covers6m) && <Row label="6 Month" value={pct(m.p6m, true)} bench="" />}
        <Row label="Year-to-date" value={pct(m.ytd, true)} bench="" />
        {(m.p1y != null || covers1y) && <Row label="1 Year" value={pct(m.p1y, true)} bench="" />}
        {m.p3y != null && <Row label="3 Year" value={pct(m.p3y, true)} bench="" />}
        {m.p5y != null && <Row label="5 Year" value={pct(m.p5y, true)} bench="" />}
        <Row label="Since Inception" value={pct(m.cum_ret, true)} bench="" accent />
        <Row label="CAGR" value={pct(m.cagr, true)} bench="" />
      </Kpm>
    </Panel>
  );
}

/**
 * Extended risk-and-distribution metrics. Collects the secondary diagnostics
 * scattered across the headline panels so a reader can scan tail behaviour in
 * one place: skew, kurtosis, VaR/CVaR, win/loss asymmetry, profit factor.
 */
function ExtendedMetricsPanel() {
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
  return (
    <Panel title="Extended Metrics">
      <Kpm>
        <Row label="Skew" value={signed(m.skew)} bench="" />
        <Row label="Kurtosis (excess)" value={num(m.kurt)} bench="" accent={m.kurt > 6} />
        <Row label="VaR 95%" value={pct(m.var95, true)} bench="" />
        <Row label="CVaR 95%" value={pct(m.cvar95, true)} bench="" />
        <Row label="P5 (daily)" value={pct(q.p05, true)} bench="" />
        <Row label="P95 (daily)" value={pct(q.p95, true)} bench="" />
        <Row label="Median (daily)" value={pct(q.p50, true)} bench="" />
        <Row label="Profit Factor" value={num(m.profit_factor)} bench="" />
        <Row label="Omega (θ=0)" value={num(m.omega_ratio)} bench="" />
        <Row label="Tail Ratio (P95/|P5|)" value={num(tailRatio)} bench="" />
        <Row label="Common-sense Ratio" value={num(commonSenseRatio)} bench="" />
        <Row label="Recovery Factor" value={num(m.recovery_factor)} bench="" accent={m.recovery_factor != null && m.recovery_factor >= 3} />
        <Row label="Pain Index" value={pct(m.pain_index)} bench="" />
        <Row label="Ulcer Index" value={pct(m.ulcer_index)} bench="" />
        <Row label="Avg Win / Avg Loss" value={ratioStr(m.avg_win, m.avg_loss)} bench="" />
      </Kpm>
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
                <td className="py-1 px-1 font-mono whitespace-nowrap text-text-2">{ymd(view.dates[r.start])}</td>
                <td className="py-1 px-1 font-mono whitespace-nowrap text-text-2">{ymd(view.dates[r.trough])}</td>
                <td className="py-1 px-1 font-mono whitespace-nowrap text-text-2">{ymd(view.dates[r.recover])}</td>
                <td className="py-1 px-1 text-right font-mono tabular-nums" style={{ color: "var(--color-negative)" }}>
                  {(r.depth * 100).toFixed(2)}%
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

function ymd(iso: string | undefined): string {
  if (!iso) return "—";
  // Already in YYYY-MM-DD from payload.dates; trim if needed.
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

/**
 * EOY Returns table: per-year strategy return + active comparator return + Δ.
 * Comparator-reactive — picker swap re-renders the right two columns.
 * Falls back to a strategy-only single column when comparator = NONE.
 */
function EoyReturnsPanel({ scopeNote }: { scopeNote?: string }) {
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
            const s = stratYearly[year];
            const b = hasBench ? benchYearly[year] : undefined;
            const delta = s != null && b != null ? s - b : null;
            return (
              <tr key={year} className="border-b border-border/30 last:border-0">
                <td className="py-1 pr-2 font-mono tabular-nums text-text-2">{year}</td>
                <td
                  className="py-1 px-2 text-right font-mono tabular-nums"
                  style={{ color: s != null && s >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}
                >
                  {pct(s, true)}
                </td>
                {hasBench && (
                  <>
                    <td
                      className="py-1 px-2 text-right font-mono tabular-nums"
                      style={{ color: b != null && b >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}
                    >
                      {pct(b, true)}
                    </td>
                    <td
                      className="py-1 pl-2 text-right font-mono tabular-nums"
                      style={{ color: delta != null && delta >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}
                    >
                      {delta != null ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp` : "—"}
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
