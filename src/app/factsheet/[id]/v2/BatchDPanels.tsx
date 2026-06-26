"use client";

import { useState } from "react";
import { usePayload } from "./factsheet-context";

/**
 * Batch D analytical panels. Three pieces:
 *   - StyleDriftPanel: real strategy returns split 50/50 + KS test
 *   - PeerPercentilePanel: synthesized cohort (tagged "Demo cohort")
 *   - AllocatorSection: demo portfolios (tagged "Demo portfolios"),
 *     interactive picker that re-renders sleeve + tail metrics
 *
 * The demo badges are visual contract: production gates these panels by
 * ingest source (real peer data, real allocator portfolio upload).
 */

export function StyleDriftPanel() {
  const payload = usePayload();
  const sd = payload.styleDrift;
  if (!sd) return null;
  const { h1, h2, ksD, ksP } = sd;
  const ksSignificant = ksP < 0.05;
  // Each half should have >=126 trading days (~6 months) for the half-vs-half
  // comparison to be meaningful. Flag if either half is below that.
  const thinHalf = h1.n < 126 || h2.n < 126;
  const rows: Array<[string, number, number, "pct" | "ratio" | "pctSigned" | "intSigned"]> = [
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
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary">
          Style Drift — First Half vs Second Half
        </h3>
        <p className="mt-0.5 text-[10px] text-text-muted">
          {monthYear(h1.start)} → {monthYear(h1.end)} ({h1.n}d) · {monthYear(h2.start)} → {monthYear(h2.end)} ({h2.n}d)
        </p>
      </header>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-2 text-left font-mono text-[9px] uppercase tracking-wider text-text-muted">Metric</th>
            <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-wider text-text-muted">First</th>
            <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-wider text-text-muted">Second</th>
            <th className="py-1 pl-2 text-right font-mono text-[9px] uppercase tracking-wider text-text-muted">Δ</th>
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
      <p className="mt-2 text-[10px] italic text-text-muted">
        Two-sample Kolmogorov-Smirnov: D = {ksD.toFixed(3)}, p = {ksP.toFixed(3)} —{" "}
        {ksSignificant ? "distributions differ at α=0.05" : "no significant distributional drift (α=0.05)"}
      </p>
      {thinHalf && (
        <p className="mt-1 text-[10px] italic" style={{ color: "var(--color-warning, #B45309)" }}>
          ⚠ One or both halves have &lt; 126 obs (≈ 6 months) — drift signal may be noisy.
        </p>
      )}
    </section>
  );
}

export function PeerPercentilePanel() {
  const payload = usePayload();
  // Dual-read (Phase 42, PEER-01, ADR-0025): the peer rank lives on the api arm
  // (`peerPercentile`, demo cohort) OR — for the scenario BLEND — on the csv arm
  // (`scenarioPeer`, ranked vs the REAL verified universe). The explicit
  // ingestSource narrow before each field access is required by the B6
  // discriminated union (a csv read of an api-only field, or vice-versa, is a
  // compile error). The parent (MetricsColumn) gates which arm reaches here.
  const isScenario = payload.ingestSource === "csv";
  const p =
    payload.ingestSource === "api"
      ? payload.peerPercentile
      : (payload.scenarioPeer ?? null);
  if (!p) return null;
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between border-b border-text pb-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary">
          Peer Percentile {!isScenario && <DemoBadge>Demo cohort</DemoBadge>}
        </h3>
        <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted">
          N={p.cohortSize}
        </span>
      </header>
      <div className="flex flex-col gap-2.5 mt-2">
        <PercentileBar label="Sharpe" pct={p.sharpe} />
        <PercentileBar label="Sortino" pct={p.sortino} />
        <PercentileBar label="Max DD (shallower = better)" pct={p.max_dd} />
      </div>
      {/* Disclosure copy (PEER-02). The api/demo-cohort path keeps its existing
          ITALIC synthesized-cohort footnote byte-identical. The scenario BLEND
          path shows the hypothetical disclosure — PLAIN 10px muted (not italic),
          U+00B7 middle-dot separators — that the blend is ranked vs the REAL
          verified universe on the engine's sample/252 basis (42-UI-SPEC §1). */}
      {isScenario ? (
        <p className="mt-2 text-[10px] text-text-muted">
          hypothetical blend · ranked vs verified strategies · sample/252 basis
        </p>
      ) : (
        <p className="mt-2 text-[10px] italic text-text-muted">
          Synthesized peer cohort (deterministic seed). Production: replace with platform strategy DB.
        </p>
      )}
    </section>
  );
}

function PercentileBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="grid grid-cols-[110px_1fr_48px] items-center gap-2 text-[11px]">
      <span className="text-text-2">{label}</span>
      <div className="relative h-2 bg-surface-subtle rounded-sm overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-accent"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      <span className="text-right font-mono tabular-nums text-text-primary">{Math.round(pct)}th</span>
    </div>
  );
}

export function AllocatorSection() {
  const payload = usePayload();
  // B6 — allocatorPortfolios lives only on the "api" arm; narrow INLINE (not an
  // early return — the useState below must stay unconditional per rules-of-hooks)
  // so a csv payload yields null and a csv field-read is a compile error. The
  // parent already gates this on ingestSource === "api". (RED-TEAM-M2)
  const portfolios = payload.ingestSource === "api" ? payload.allocatorPortfolios : null;
  const [active, setActive] = useState(portfolios?.[0]?.key ?? "");
  if (!portfolios || portfolios.length === 0) return null;
  const p = portfolios.find(x => x.key === active) ?? portfolios[0];

  return (
    <section className="mt-12 border-t border-border pt-8">
      <header className="mb-4">
        <h2 className="text-lg font-semibold uppercase tracking-wider text-text-primary">
          Allocator Portfolio Analysis <DemoBadge>Demo portfolios</DemoBadge>
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          Pick a sample portfolio to preview sleeve sizing and tail co-movement.
          Production will accept a CSV upload (<code className="font-mono text-[11px]">date,nav</code>) or pick
          from saved allocator portfolios.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 mb-2">
        {portfolios.map(opt => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setActive(opt.key)}
            className={
              "px-3 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm border transition-colors " +
              (opt.key === active
                ? "bg-accent text-white border-accent"
                : "bg-surface-subtle text-text-2 border-border hover:bg-surface")
            }
          >
            {opt.name}
          </button>
        ))}
      </div>
      <p className="text-[11px] italic text-text-muted mb-6">{p.composition}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary border-b border-text pb-1 mb-2">
            Sleeve Sizing
          </h3>
          <p className="text-[10px] text-text-muted italic mb-2">
            Target portfolio vol = {(p.vol_target * 100).toFixed(0)}% · search 1% allocation grid for closest blended vol
          </p>
          <table className="w-full text-[12px]">
            <tbody>
              <KvRow k="Portfolio Vol (ann)" v={`${(p.ann_vol * 100).toFixed(1)}%`} />
              <KvRow k="Correlation with MultiMarket" v={signed(p.corr)} />
              <KvRow k="Cum. Return (full window)" v={pctSigned(p.cum_ret)} />
              <KvRow k="Max Drawdown" v={`${(p.max_dd * 100).toFixed(1)}%`} negative />
              <KvSep />
              <KvRow k="Suggested MultiMarket sleeve" v={`${Math.round(p.sleeve_pct * 100)}%`} accent />
              <KvRow k="Blended Vol at sleeve %" v={`${(p.blend_vol * 100).toFixed(1)}%`} />
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary border-b border-text pb-1 mb-2">
            Tail Co-Movement
          </h3>
          <p className="text-[10px] text-text-muted italic mb-2">
            Rolling 21-day windows where the portfolio drew ≥ 5% · MultiMarket&apos;s same-window behaviour
          </p>
          <table className="w-full text-[12px]">
            <tbody>
              <KvRow k="Stress windows in sample" v={String(p.tail_count)} />
              <KvRow k="MultiMarket mean return" v={pctSigned2(p.tail_mm_mean)} />
              <KvRow k="MultiMarket median return" v={pctSigned2(p.tail_mm_median)} />
              <KvRow k="Windows MM was positive" v={`${Math.round(p.tail_mm_pos * 100)}%`} accent />
            </tbody>
          </table>
          <p className="mt-2 text-[10px] italic text-text-muted">
            {p.tail_count === 0
              ? "No stress windows in the observed sample — portfolio never drew ≥ 5% in any 21-day window."
              : `During the ${p.tail_count} stress windows, MultiMarket was positive ${Math.round(p.tail_mm_pos * 100)}% of the time.`}
          </p>
        </div>
      </div>
    </section>
  );
}

function DemoBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 inline-block px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider align-middle bg-surface-subtle text-text-muted border border-border rounded-sm">
      {children}
    </span>
  );
}

function KvRow({ k, v, accent, negative }: { k: string; v: string; accent?: boolean; negative?: boolean }) {
  return (
    <tr className="border-b border-border/30 last:border-0">
      <td className="py-1 pr-2 text-text-2">{k}</td>
      <td
        className={
          "py-1 pl-2 text-right font-mono tabular-nums " +
          (accent ? "text-accent text-[14px]" : negative ? "text-text-primary" : "text-text-primary")
        }
        style={negative ? { color: "var(--color-negative, currentColor)" } : undefined}
      >
        {v}
      </td>
    </tr>
  );
}

function KvSep() {
  return (
    <tr>
      <td colSpan={2} className="py-1">
        <hr className="border-t border-border" />
      </td>
    </tr>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function monthYear(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function fmt(v: number, kind: "pct" | "ratio" | "pctSigned" | "intSigned"): string {
  if (!Number.isFinite(v)) return "—";
  if (kind === "pct") return `${(v * 100).toFixed(1)}%`;
  if (kind === "pctSigned") return `${(v * 100).toFixed(1)}%`; // depth-style — sign already in value
  if (kind === "intSigned") return (v >= 0 ? "+" : "") + v.toFixed(2);
  return v.toFixed(2);
}

function fmtDelta(a: number, b: number, kind: "pct" | "ratio" | "pctSigned" | "intSigned"): string {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "—";
  const d = b - a;
  if (kind === "pct" || kind === "pctSigned") {
    const x = d * 100;
    return `${x >= 0 ? "+" : ""}${x.toFixed(1)}pp`;
  }
  return (d >= 0 ? "+" : "") + d.toFixed(2);
}

function signed(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}

function pctSigned(v: number): string {
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
}

function pctSigned2(v: number): string {
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%";
}
