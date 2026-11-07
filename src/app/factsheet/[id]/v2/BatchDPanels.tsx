"use client";

import { usePayload } from "./factsheet-context";
import { useBasisOrCash, useBasisSeriesView, BaseLeverageNote } from "./basis-context";
import { formatFixedSigned, signTone } from "@/lib/factsheet/display-sign";

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
  const view = useBasisSeriesView(usePayload());
  const sd = view.styleDrift;
  if (!sd) return null;
  const { h1, h2, ksD, ksP } = sd;
  const ksSignificant = ksP < 0.05;
  // Each half should have >=126 trading days (~6 months) for the half-vs-half
  // comparison to be meaningful. Flag if either half is below that.
  const thinHalf = h1.n < 126 || h2.n < 126;
  const rows: Array<[string, number, number, DriftKind]> = [
    ["Sharpe", h1.sharpe, h2.sharpe, "ratio"],
    ["Sortino", h1.sortino, h2.sortino, "ratio"],
    ["Ann. Volatility", h1.ann_vol, h2.ann_vol, "pct"],
    ["Skew", h1.skew, h2.skew, "intSigned"],
    ["Kurtosis", h1.kurt, h2.kurt, "ratio"],
    ["Max Drawdown", h1.max_dd, h2.max_dd, "pctSigned"],
    ["Win % (days)", h1.win_rate, h2.win_rate, "pct"],
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
          {rows.map(([label, a, b, kind]) => (
            <tr key={label} className="border-b border-border/30 last:border-0">
              <td className="py-1 pr-2 text-text-2">{label}</td>
              <td className="py-1 px-2 text-right font-mono tabular-nums text-text-primary">{fmt(a, kind)}</td>
              <td className="py-1 px-2 text-right font-mono tabular-nums text-text-primary">{fmt(b, kind)}</td>
              <td className="py-1 pl-2 text-right font-mono tabular-nums text-text-2">{fmtDelta(a, b, kind)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-micro italic text-text-muted">
        Two-sample Kolmogorov-Smirnov: D = {ksD.toFixed(3)}, p = {ksP.toFixed(3)} —{" "}
        {ksSignificant ? "distributions differ at α=0.05" : "no significant distributional drift (α=0.05)"}
      </p>
      {thinHalf && (
        <p className="mt-1 text-micro italic" style={{ color: "var(--color-warning, #B45309)" }}>
          ⚠ One or both halves have &lt; 126 obs (≈ 6 months) — drift signal may be noisy.
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
        <PercentileBar label="Sharpe" pct={p.sharpe} />
        <PercentileBar label="Sortino" pct={p.sortino} />
        <PercentileBar label="Max DD (shallower = better)" pct={p.max_dd} />
      </div>
      {/* Disclosure copy (PEER-02): the scenario BLEND shows the hypothetical
          disclosure — PLAIN 10px muted (not italic), U+00B7 middle-dot separators —
          that the blend is ranked vs the REAL verified universe on the engine's
          sample/252 basis (42-UI-SPEC §1). */}
      <p className="mt-2 text-micro text-text-muted">
        hypothetical blend · ranked vs verified strategies · sample/252 basis
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
  return (
    <section>
      <header className="mb-2 border-b border-text pb-1">
        <h3 className="text-small font-semibold uppercase tracking-wider text-text-primary">
          vs Your Book
        </h3>
      </header>
      <table className="w-full text-caption">
        <tbody>
          <DeltaRow label="Sharpe" value={delta.sharpe} kind="ratio" />
          <DeltaRow label="Sortino" value={delta.sortino} kind="ratio" />
          <DeltaRow label="Max DD (blend vs book)" value={delta.max_dd} kind="maxdd" />
        </tbody>
      </table>
      <p className="mt-2 text-micro italic text-text-muted">
        Delta = blend minus your live book · sample/252 basis · over each series&rsquo; own window
        ({delta.blend_n.toLocaleString()} obs blend · {delta.book_n.toLocaleString()} obs book)
      </p>
    </section>
  );
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

function PercentileBar({ label, pct }: { label: string; pct: number | null }) {
  // No rank (the strategy has no Sharpe: NaN, or null after a JSON cache
  // round-trip) renders "—" over an empty track, never "0th" or "NaNth"
  // (founder decision D7, 2026-09-26).
  const ranked = pct != null && Number.isFinite(pct);
  return (
    <div className="grid grid-cols-[110px_1fr_48px] items-center gap-2 text-micro">
      <span className="text-text-2">{label}</span>
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
