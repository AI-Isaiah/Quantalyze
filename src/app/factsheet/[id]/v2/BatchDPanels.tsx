"use client";

import { usePayload } from "./factsheet-context";
import { useBasisOrCash, useBasisSeriesView, BaseLeverageNote } from "./basis-context";
import { formatFixedSigned, signTone } from "@/lib/factsheet/display-sign";
import {
  SHORT_TRACK_MARKER,
  gateAnnualized,
  gateDelta,
  gatedValue,
  recordClears,
  shortTrackMarkerTitle,
  shorterSpan,
  coveredDays,
  widenedShortNote,
  widenedWithheldReason,
  type FigureRecord,
  type FigureState,
} from "@/lib/figure-gate";

/**
 * Batch D analytical panels. Three pieces:
 *   - StyleDriftPanel: real strategy returns split 50/50 + KS test
 *   - PeerPercentilePanel: the scenario blend ranked against the verified universe
 *   - OwnBookDeltaPanel: the scenario blend against the allocator's own book
 *
 * The demo allocator section was removed in QUIETVIEW (D-05).
 */

export function StyleDriftPanel() {
  // Phase 103 (MTM-04): the 50/50 half-vs-half KS drift is a pure function of the
  // strategy's own daily series → follows the active basis (cash view === payload).
  const payload = usePayload();
  const view = useBasisSeriesView(payload);
  const sd = view.styleDrift;
  if (!sd) return null;
  const { h1, h2, ksD, ksP } = sd;
  // 194 D-04 / D-15 (2026-11-07): each half is a window of the strategy's ONE record, so the
  // annualized rows (Sharpe, Sortino, Ann. Volatility) and their deltas are withheld only when
  // that TOTAL record fails the gate; the SHORTER half only qualifies them (one muted note
  // while it is under a year). An absent record is the `null` state: figures show, no note.
  const record = payload.figureRecord ?? null;
  const shorterHalf = shorterSpan(coveredDays(h1.start, h1.end), coveredDays(h2.start, h2.end));
  const verdict = record ? gateAnnualized(record, shorterHalf) : "null";
  const withheld = verdict === "withheld";
  const gateNote =
    record && withheld
      ? widenedWithheldReason("half", record)
      : verdict === "short" && shorterHalf != null
        ? widenedShortNote("half", shorterHalf)
        : null;
  const ksSignificant = ksP < 0.05;
  // Each half should have >=126 trading days (~6 months) for the half-vs-half
  // comparison to be meaningful. Flag if either half is below that.
  const thinHalf = h1.n < 126 || h2.n < 126;
  // The fifth member marks a row annualized (withheld with the record, D-15).
  const rows: Array<[string, number, number, DriftKind, boolean]> = [
    ["Sharpe", h1.sharpe, h2.sharpe, "ratio", true],
    ["Sortino", h1.sortino, h2.sortino, "ratio", true],
    ["Ann. Volatility", h1.ann_vol, h2.ann_vol, "pct", true],
    ["Skew", h1.skew, h2.skew, "intSigned", false],
    ["Kurtosis", h1.kurt, h2.kurt, "ratio", false],
    ["Max Drawdown", h1.max_dd, h2.max_dd, "pctSigned", false],
    ["Win % (days)", h1.win_rate, h2.win_rate, "pct", false],
  ];
  return (
    <section>
      <header className="mb-2 border-b border-text pb-1">
        <h3 className="text-small font-semibold uppercase tracking-wider text-text-primary">
          Style Drift — First Half vs Second Half
        </h3>
        <p className="mt-0.5 text-micro text-text-muted">
          {monthYear(h1.start)} → {monthYear(h1.end)} ({h1.n}d) · {monthYear(h2.start)} → {monthYear(h2.end)} ({h2.n}d)
        </p>
      </header>
      <table className="w-full text-micro">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-2 text-left font-mono text-micro uppercase tracking-wider text-text-muted">Metric</th>
            <th className="py-1 px-2 text-right font-mono text-micro uppercase tracking-wider text-text-muted">First</th>
            <th className="py-1 px-2 text-right font-mono text-micro uppercase tracking-wider text-text-muted">Second</th>
            <th className="py-1 pl-2 text-right font-mono text-micro uppercase tracking-wider text-text-muted">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b, kind, annualized]) => {
            // A withheld annualized row prints an untoned dash in both halves and the delta.
            const dash = annualized && withheld;
            return (
              <tr key={label} className="border-b border-border/30 last:border-0">
                <td className="py-1 pr-2 text-text-2">{label}</td>
                <td className="py-1 px-2 text-right font-mono tabular-nums text-text-primary">{dash ? "—" : fmt(a, kind)}</td>
                <td className="py-1 px-2 text-right font-mono tabular-nums text-text-primary">{dash ? "—" : fmt(b, kind)}</td>
                <td className="py-1 pl-2 text-right font-mono tabular-nums text-text-2">{dash ? "—" : fmtDelta(a, b, kind)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {gateNote && (
        <p data-testid="style-drift-figure-gate-note" className="mt-2 text-micro italic text-text-muted">
          {gateNote}
        </p>
      )}
      <p className="mt-2 text-micro italic text-text-muted">
        Two-sample Kolmogorov-Smirnov: D = {ksD.toFixed(3)}, p = {ksP.toFixed(3)} —{" "}
        {ksSignificant ? "distributions differ at α=0.05" : "no significant distributional drift (α=0.05)"}
      </p>
      {/* 194 D-13 (A-194-D13-03, founder 2026-11-07): a short-record warning is one muted
          note with no glyph and no warning colour; the words and the trigger are unchanged. */}
      {thinHalf && (
        <p className="mt-1 text-micro italic text-text-muted">
          One or both halves have &lt; 126 obs (≈ 6 months) — drift signal may be noisy.
        </p>
      )}
    </section>
  );
}

export function PeerPercentilePanel() {
  const payload = usePayload();
  const basis = useBasisOrCash();
  // Phase 193 (QUIETVIEW, D-04): this panel ranks the scenario BLEND against the
  // REAL verified universe (the csv arm's `scenarioPeer`, Phase 42 PEER-01,
  // ADR-0025). The synthesized demo-cohort arm was removed: an api factsheet
  // renders nothing here. The explicit ingestSource narrow before the field read
  // is required by the B6 discriminated union (a read of a csv-only field on the
  // api arm is a compile error).
  const p = payload.ingestSource === "csv" ? (payload.scenarioPeer ?? null) : null;
  if (!p) return null;
  // 194 D-11 / D-15 (2026-11-07): the blend's verdict is the TOTAL record's, from plan 04's
  // `figureRecord`. Sharpe and Sortino are annualized, so a short blend (cleared, under one
  // year) carries the `<1y` marker and a withheld one ranks as no rank; Max DD is not
  // annualized and gets neither. (Plan 05 builds the peer request only for a blend that
  // clears the gate, so the withheld arm is a backstop.)
  const record = payload.figureRecord ?? null;
  const blendState = record ? gateAnnualized(record) : "null";
  const blendWithheld = blendState === "withheld";
  // 194 R3 WR-02: the caption names the basis the blend's own figures ride, never a constant.
  // The record's `crypto` flag is `periodsPerYear === 365`; an absent record is unknown, which
  // counts as crypto (365), the same rule the engine applies to an unknown class.
  const basisDays = record?.crypto === false ? 252 : 365;
  const marker = blendState === "short" && record?.spanDays != null ? shortTrackMarkerTitle(record.spanDays) : null;
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between border-b border-text pb-1">
        <h3 className="text-small font-semibold uppercase tracking-wider text-text-primary">
          Peer Percentile
        </h3>
        <span className="text-micro font-mono uppercase tracking-wider text-text-muted">
          N={p.cohortSize}
        </span>
      </header>
      <div className="flex flex-col gap-2.5 mt-2">
        <PercentileBar label="Sharpe" pct={blendWithheld ? null : p.sharpe} marker={marker} />
        <PercentileBar label="Sortino" pct={blendWithheld ? null : p.sortino} marker={marker} />
        <PercentileBar label="Max DD (shallower = better)" pct={p.max_dd} />
      </div>
      {/* Disclosure copy (PEER-02): the scenario BLEND shows the hypothetical
          disclosure — PLAIN 10px muted (not italic), U+00B7 middle-dot separators —
          that the blend is ranked vs the REAL verified universe on the engine's
          sample basis at the blend's own annualisation (42-UI-SPEC §1, 194 R3 WR-02). */}
      <p className="mt-2 text-micro text-text-muted">
        hypothetical blend · ranked vs verified strategies · sample/{basisDays} basis
      </p>
      {/* F6 (phase 103, no-invented-data): this is a CROSS-STRATEGY panel — the
          rank compares this book against a peer cohort computed on the
          cash-settlement basis. The cohort is NOT recomputed per basis (there is no
          mark-to-market peer universe to rank against), so under a NON-cash basis we
          surface an HONEST note rather than fabricate a per-basis cohort. Phase 133
          (SMTM-01): smoothed_mtm gets the SAME honest note as mark_to_market (there is
          no smoothed peer universe either). Cash renders nothing extra (byte-identical). */}
      {(basis === "mark_to_market" || basis === "smoothed_mtm") && (
        <p className="mt-1 text-micro text-text-muted">
          Peer rank is computed on the cash-settlement basis; the cohort is not recomputed per basis.
        </p>
      )}
      {/* H-1 (Phase 107 Fable red team): the peer rank is a server-side rank against a
          cohort distribution NOT carried in the payload, so it cannot follow a client
          leverage what-if — it stays at base 1×. Honest per-panel note at L≠1. */}
      <BaseLeverageNote payload={payload} label="Peer rank shown at base 1× leverage" />
    </section>
  );
}

/**
 * OwnBookDeltaPanel (Phase 42, PEER-05) — the scenario blend's head-to-head delta
 * vs the allocator's LIVE book.
 *
 * Renders ONLY for the scenario blend: it reads the csv-only `scenarioOwnBookDelta`
 * carve-out (narrowed on `ingestSource === "csv"`) and returns null on every
 * non-scenario factsheet (real route byte-identical). When the allocator has no
 * live book the carve-out is absent → the panel is SILENTLY ABSENT (no zeroed
 * deltas, no "add your book" CTA — a conversion action is out of scope here).
 *
 * Each value is a SIGNED delta on the SAME sample/252 basis as the peer rank
 * (T-42-15): blend − book. The sign is ALWAYS carried in TEXT ("+"/U+2212), never
 * color-only (WCAG 1.4.1):
 *   - Sharpe / Sortino: positive delta → --color-positive (blend > book is better);
 *     negative → --color-negative.
 *   - Max DD: the color mapping is INVERTED — a positive delta means the blend's
 *     max_dd is LESS negative (shallower = better) → --color-positive; rendered in
 *     percentage-points (pp).
 * A null single-ratio delta renders "—" (insufficient data) without crashing.
 *
 * The basis note discloses BOTH observation counts (blend_n · book_n). The two
 * legs share the sample/252 FORMULA but generally span DIFFERENT calendar windows
 * (the blend's constituent-overlap window vs the allocator's full live-book
 * history), so showing both counts keeps the "vs Your Book" framing honest about
 * the window mismatch instead of implying full comparability (WR-02).
 */
export function OwnBookDeltaPanel() {
  const payload = usePayload();
  const delta =
    payload.ingestSource === "csv" ? (payload.scenarioOwnBookDelta ?? null) : null;
  if (!delta) return null;
  // 194 D-11 / D-15 (2026-11-07): the Sharpe and Sortino deltas are withheld when EITHER compared
  // TOTAL record fails the gate (`records`, set by plan 17); a cleared pair over a window under
  // one year keeps the values with one muted note. Absent `records` is the `null` state: the
  // deltas show as before and no note is printed. The Max DD delta is not annualized.
  const records = delta.records ?? null;
  const spanForDelta = delta.span_days ?? null;
  const deltaState: FigureState = records ? gateDelta(records.blend, records.book, spanForDelta) : "null";
  const deltaNote = records ? ownBookDeltaNote(deltaState, records, spanForDelta) : null;
  // 194 R3 WR-02: both legs are annualised at the blend's basis (BLEND-01), so the caption reads
  // it off the blend record; an absent record is unknown, which counts as crypto (365).
  const basisDays = records?.blend.crypto === false ? 252 : 365;
  return (
    <section>
      <header className="mb-2 border-b border-text pb-1">
        <h3 className="text-small font-semibold uppercase tracking-wider text-text-primary">
          vs Your Book
        </h3>
      </header>
      <table className="w-full text-caption">
        <tbody>
          <DeltaRow label="Sharpe" value={gatedValue(delta.sharpe, deltaState)} kind="ratio" />
          <DeltaRow label="Sortino" value={gatedValue(delta.sortino, deltaState)} kind="ratio" />
          <DeltaRow label="Max DD (blend vs book)" value={delta.max_dd} kind="maxdd" />
        </tbody>
      </table>
      <p className="mt-2 text-micro italic text-text-muted">
        Delta = blend minus your live book · sample/{basisDays} basis · over each series&rsquo; own window
        ({delta.blend_n.toLocaleString()} obs blend · {delta.book_n.toLocaleString()} obs book)
      </p>
      {deltaNote && (
        <p data-testid="own-book-delta-note" className="mt-1 text-micro text-text-muted">
          {deltaNote}
        </p>
      )}
    </section>
  );
}

/**
 * The one muted line under the basis line: the withheld reason (naming the failing record, the
 * shorter by span when both fail, so the line states the tighter shortfall) or the short note
 * (compared window under one year). Null for `full` and `null`.
 */
function ownBookDeltaNote(
  state: FigureState,
  records: { blend: FigureRecord; book: FigureRecord },
  comparedSpanDays: number | null,
): string | null {
  if (state === "withheld") {
    const failing = [records.blend, records.book].filter((r) => recordClears(r) === false);
    const shortest = failing.reduce((a, b) => ((b.spanDays ?? 0) < (a.spanDays ?? 0) ? b : a));
    return widenedWithheldReason("delta", shortest);
  }
  if (state === "short" && comparedSpanDays != null) return widenedShortNote("delta", comparedSpanDays);
  return null;
}

/**
 * One own-book delta row. The sign is in the TEXT ("+"/U+2212 minus), never
 * color-only. `ratio` rows color by sign; `maxdd` rows INVERT the color mapping
 * (a positive delta = shallower = good = positive token) and render in pp. A null
 * delta renders "—" (insufficient data) with no color.
 */
function DeltaRow({
  label,
  value,
  kind,
}: {
  label: string;
  value: number | null;
  kind: "ratio" | "maxdd";
}) {
  // The sign is carried in TEXT as "+" or U+2212 (WCAG non-color-only); a delta that
  // rounds to zero at the printed precision prints unsigned (170.6 D-02).
  const display =
    kind === "maxdd"
      ? formatFixedSigned(value, { dp: 1, scale: 100, suffix: "pp", plus: true, minus: "−" })
      : formatFixedSigned(value, { dp: 2, plus: true, minus: "−" });
  // Color follows FAVORABILITY, not the raw sign. For ratios, higher (positive
  // delta) is better. For max_dd the delta is `blend.max_dd − book.max_dd` on
  // negative drawdown values, so a POSITIVE delta = blend's max_dd is LESS
  // negative = shallower = better — favorable. Both kinds therefore map
  // positive→positive here; the UI-SPEC "inversion" is relative to the naive
  // reading that a positive change in a drawdown (loss) field is bad, which it
  // is NOT once the delta is taken on the signed (negative) drawdown values.
  // Phase 170.6 (D-03, O-4): the mapping reads the sign of the ROUNDED delta, so a delta that
  // prints "0.00" or "0.0pp" is neutral. D-04 (never green) governs a drawdown VALUE, not this delta.
  const tone = kind === "maxdd" ? signTone(value, 1, 100) : signTone(value, 2);
  const color =
    tone === "positive" ? "var(--color-positive)" : tone === "negative" ? "var(--color-negative)" : undefined;
  return (
    <tr className="border-b border-border/30 last:border-0">
      <td className="py-1.5 pr-2 text-text-2">{label}</td>
      <td
        className="py-1.5 pl-2 text-right font-mono tabular-nums text-text-primary"
        style={color ? { color } : undefined}
      >
        {display}
      </td>
    </tr>
  );
}

function PercentileBar({
  label,
  pct,
  marker = null,
}: {
  label: string;
  pct: number | null;
  /** The `<1y` marker's title text (`shortTrackMarkerTitle`); null renders no marker. */
  marker?: string | null;
}) {
  // No rank (the strategy has no Sharpe: NaN, or null after a JSON cache
  // round-trip) renders "—" over an empty track, never "0th" or "NaNth"
  // (founder decision D7, 2026-09-26).
  const ranked = pct != null && Number.isFinite(pct);
  return (
    <div className="grid grid-cols-[110px_1fr_48px] items-center gap-2 text-micro">
      <span className="text-text-2">
        {label}
        {marker != null && (
          <span
            title={marker}
            className="ml-1 inline-block min-w-[3ch] text-right align-baseline text-micro font-mono tabular-nums text-text-muted"
          >
            {SHORT_TRACK_MARKER}
            <span className="sr-only"> {marker}</span>
          </span>
        )}
      </span>
      <div className="relative h-2 bg-surface-subtle rounded-sm overflow-hidden">
        {ranked && (
          <div
            className="absolute inset-y-0 left-0 bg-accent"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        )}
      </div>
      <span className="text-right font-mono tabular-nums text-text-primary">{ranked ? `${Math.round(pct)}th` : "—"}</span>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function monthYear(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

type DriftKind = "pct" | "ratio" | "pctSigned" | "intSigned";

function fmt(v: number, kind: DriftKind): string {
  if (kind === "pct") return formatFixedSigned(v, { dp: 1, scale: 100, suffix: "%" });
  if (kind === "pctSigned") return formatFixedSigned(v, { dp: 1, scale: 100, suffix: "%" }); // depth-style — sign already in value
  if (kind === "intSigned") return formatFixedSigned(v, { dp: 2, plus: true });
  return formatFixedSigned(v, { dp: 2 });
}

function fmtDelta(a: number, b: number, kind: DriftKind): string {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "—";
  const d = b - a;
  if (kind === "pct" || kind === "pctSigned") return formatFixedSigned(d, { dp: 1, scale: 100, suffix: "pp", plus: true });
  return formatFixedSigned(d, { dp: 2, plus: true });
}
