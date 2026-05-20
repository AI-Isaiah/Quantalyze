"use client";

import type { ReactNode } from "react";
import type { JointMetrics } from "@/lib/factsheet/types";
import { usePayload, useActiveComparator } from "./factsheet-context";
import { CalmarByYearPanel, BootstrapCIPanel } from "./AnalyticalPanels";
import { StyleDriftPanel, PeerPercentilePanel } from "./BatchDPanels";
import { StrategyThesisPanel, TermsPanel, LeverageProfilePanel } from "./MandatePanels";

/**
 * Editorial right-column metrics. Four named sections — Performance, Risk,
 * Style, Benchmark — each introduced by a serif-italic eyebrow over a thick
 * hairline divider, then a stack of dense KPM tables.
 *
 * No card chrome between sub-panels: hairline section dividers carry the
 * structure, matching DESIGN.md's "data density > card density" rule and
 * the FactSet quarterly-factsheet reference.
 */
export function MetricsColumn() {
  const payload = usePayload();
  const { block: cmp } = useActiveComparator();
  const m = payload.strategyMetrics;
  const b = cmp.summary;
  const bn = cmp.shortName;

  return (
    <aside className="flex flex-col gap-12">
      <StrategyThesisPanel />
      <EditorialSection label="I" name="Performance">
        <Panel title="Compound Performance">
          <Kpm>
            <Row label="Start Date" value={isoToMonthDay(m.start)} bench="" />
            <Row label="End Date" value={isoToMonthDay(m.end)} bench="" />
            <Row label="Years Observed" value={m.years.toFixed(2)} bench="" />
          </Kpm>
        </Panel>
        <Panel title="Main Metrics" benchHeader={bn}>
          {m.n < 252 && (
            <p className="mb-2 text-[10px] italic" style={{ color: "var(--color-warning, #B45309)" }}>
              ⚠ Only {m.n} observations ({(m.n / 252).toFixed(2)}y) — Sharpe / Sortino / Calmar below
              have wide statistical confidence intervals. Conventional reliability threshold is
              ≥ 252 trading days (1 year).
            </p>
          )}
          <Kpm>
            <Row label="Cumulative Return" value={pct(m.cum_ret, true)} bench={pct(b?.cum_ret, true)} />
            <Row label="CAGR" value={pct(m.cagr, true)} bench={pct(b?.cagr, true)} />
            <Row label="Ann. Volatility" value={pct(m.ann_vol)} bench={pct(b?.ann_vol)} />
            <Row label="Sharpe" value={num(m.sharpe)} bench={num(b?.sharpe)} accent />
            <Row label="Sortino" value={num(m.sortino)} bench={num(b?.sortino)} />
            <Row label="Calmar" value={num(m.calmar)} bench={num(b?.calmar)} />
            <Row label="Skew" value={signed(m.skew)} bench="" />
            <Row label="Kurtosis" value={num(m.kurt)} bench="" />
          </Kpm>
        </Panel>
        <Panel title="Returns">
          <Kpm>
            <Row label="Month-to-date" value={pct(m.mtd, true)} bench="" />
            <Row label="Year-to-date" value={pct(m.ytd, true)} bench="" />
            <Row label="3 Month" value={pct(m.p3m, true)} bench="" />
            <Row label="6 Month" value={pct(m.p6m, true)} bench="" />
            <Row label="1 Year" value={pct(m.p1y, true)} bench="" />
            <Row label="Win Rate (days)" value={pct(m.win_rate)} bench="" />
            <Row label="Profit Factor" value={num(m.profit_factor)} bench="" />
          </Kpm>
        </Panel>
        <EoyReturnsPanel />
        <RollingMetricsPanel />
        <CumulativeReturnsPanel />
      </EditorialSection>

      <EditorialSection label="II" name="Risk">
        <Panel title="Max Drawdown">
          <Kpm>
            <Row label="Max Drawdown" value={pctNeg(m.max_dd)} bench={pctNeg(b?.max_dd)} accent />
            <Row label="Longest DD (days)" value={String(m.longest_dd)} bench={b ? String(b.longest_dd) : "—"} />
            <Row label="VaR 95%" value={pct(m.var95, true)} bench="" />
            <Row label="CVaR 95%" value={pct(m.cvar95, true)} bench="" />
            <Row label="Avg Win" value={pct(m.avg_win, true)} bench="" />
            <Row label="Avg Loss" value={pct(m.avg_loss, true)} bench="" />
          </Kpm>
        </Panel>
        <BootstrapCIPanel />
        <Panel title="Best / Worst Period">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-text">
                <th className="text-left py-1 pr-2 font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Scale</th>
                <th className="text-right py-1 px-2 font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Best</th>
                <th className="text-right py-1 pl-2 font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Worst</th>
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

      <EditorialSection label="III" name="Style">
        <StyleDriftPanel />
        <PeerPercentilePanel />
      </EditorialSection>

      <EditorialSection label="V" name="Terms">
        <LeverageProfilePanel />
        <TermsPanel />
      </EditorialSection>

      {cmp.joint && (
        <EditorialSection label="IV" name={`Benchmark — vs ${bn}`}>
          <BenchmarkMetricsBody joint={cmp.joint} />
        </EditorialSection>
      )}
    </aside>
  );
}

/** Editorial section: roman-numeral eyebrow over an Instrument Serif name + thick rule. */
function EditorialSection({ label, name, children }: { label: string; name: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-6">
      <header className="border-b-[2px] border-text pb-2">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-text-muted">
            §{label}
          </span>
          <h2 className="font-serif italic text-[22px] leading-tight text-text-primary">{name}</h2>
        </div>
      </header>
      {children}
    </section>
  );
}

function BenchmarkMetricsBody({ joint }: { joint: JointMetrics }) {
  return (
    <Panel title="Joint Metrics" hideHeaderRule>
      <Kpm>
        <Row label="Alpha (ann)" value={pct(joint.alpha, true)} bench="" accent />
        <Row label="Beta" value={num(joint.beta)} bench="" />
        <Row label="Correlation" value={num(joint.corr)} bench="" />
        <Row label="R²" value={num(joint.r2)} bench="" />
        <Row label="Information Ratio" value={num(joint.info_ratio)} bench="" />
        <Row label="Treynor" value={num(joint.treynor)} bench="" />
        <Row label="Tracking Error" value={pct(joint.tracking_error)} bench="" />
        <Row label="Up Capture" value={num(joint.up_capture)} bench="" />
        <Row label="Down Capture" value={num(joint.down_capture)} bench="" />
      </Kpm>
    </Panel>
  );
}

function Panel({
  title,
  children,
  benchHeader,
  hideHeaderRule,
}: {
  title: string;
  children: ReactNode;
  benchHeader?: string;
  hideHeaderRule?: boolean;
}) {
  return (
    <section>
      <header
        className={
          "mb-2 flex items-baseline justify-between " +
          (hideHeaderRule ? "" : "border-b border-border pb-1")
        }
      >
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-text-primary">
          {title}
        </h3>
        {benchHeader != null && benchHeader !== "" && (
          <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-text-muted">
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
    <table className="w-full text-[12px]">
      <tbody>{children}</tbody>
    </table>
  );
}

function Row({ label, value, bench, accent }: { label: string; value: string; bench: string; accent?: boolean }) {
  return (
    <tr className="border-b border-border/30 last:border-0">
      <td className="py-1.5 pr-2 text-text-2">{label}</td>
      <td
        className={
          "py-1.5 px-2 text-right font-mono tabular-nums " +
          (accent ? "text-accent font-medium" : "text-text-primary")
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
      <td className="py-1 pr-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
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

function isoToMonthDay(iso: string): string {
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

/**
 * Rolling 6-month metrics summarised across the entire warm-window history:
 * current value (most recent non-null), min, max, average. Lets a reader judge
 * how stable each rolling stat has been over the strategy's life.
 */
function RollingMetricsPanel() {
  const payload = usePayload();
  const v = rollingStats(payload.strategyRollingVol);
  const sh = rollingStats(payload.strategyRollingSharpe);
  const so = rollingStats(payload.strategyRollingSortino);
  return (
    <Panel title="Rolling Metrics (6mo)">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-2 text-left font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Metric</th>
            <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Now</th>
            <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Avg</th>
            <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Min</th>
            <th className="py-1 pl-2 text-right font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Max</th>
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
      <td className={"py-1 px-2 text-right font-mono tabular-nums " + (accent ? "text-accent font-medium" : "text-text-primary")}>
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
  const payload = usePayload();
  const m = payload.strategyMetrics;
  const eq = payload.strategyEquity;
  const n = eq.length;
  const last = n > 0 ? eq[n - 1] : 1;
  const periodReturn = (lookbackDays: number): number | null => {
    if (n < 2) return null;
    const startIdx = Math.max(0, n - 1 - lookbackDays);
    const base = eq[startIdx];
    return base > 0 ? last / base - 1 : null;
  };
  // Inception return = cum_ret (no need to recompute).
  return (
    <Panel title="Cumulative Return Metrics">
      <Kpm>
        <Row label="Month-to-date" value={pct(m.mtd, true)} bench="" />
        <Row label="3 Month" value={pct(m.p3m, true)} bench="" />
        <Row label="6 Month" value={pct(m.p6m, true)} bench="" />
        <Row label="Year-to-date" value={pct(m.ytd, true)} bench="" />
        <Row label="1 Year" value={pct(m.p1y, true)} bench="" />
        <Row label="3 Year" value={pct(periodReturn(3 * 252), true)} bench="" />
        <Row label="5 Year" value={pct(periodReturn(5 * 252), true)} bench="" />
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
  const payload = usePayload();
  const m = payload.strategyMetrics;
  const q = payload.quantiles;
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
        <Row label="Tail Ratio (P95/|P5|)" value={num(m.tail_ratio)} bench="" />
        <Row label="Common-sense Ratio" value={num(m.common_sense_ratio)} bench="" />
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
  let current: number | null = null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (current == null) current = v;
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
  const payload = usePayload();
  const rows = payload.strategyWorst10;
  if (rows.length === 0) return null;
  return (
    <Panel title="Worst 10 Drawdowns">
      <table className="w-full text-[10.5px]">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-1 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">#</th>
            <th className="py-1 px-1 text-left font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">Peak</th>
            <th className="py-1 px-1 text-left font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">Trough</th>
            <th className="py-1 px-1 text-left font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">Recov.</th>
            <th className="py-1 px-1 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">Depth</th>
            <th
              className="py-1 px-1 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted"
              title="Days from peak to trough"
            >
              DD d
            </th>
            <th
              className="py-1 px-1 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted"
              title="Days from trough to recovery"
            >
              Rec d
            </th>
            <th
              className="py-1 pl-1 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted"
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
                <td className="py-1 px-1 font-mono whitespace-nowrap text-text-2">{ymd(payload.dates[r.start])}</td>
                <td className="py-1 px-1 font-mono whitespace-nowrap text-text-2">{ymd(payload.dates[r.trough])}</td>
                <td className="py-1 px-1 font-mono whitespace-nowrap text-text-2">{ymd(payload.dates[r.recover])}</td>
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
function EoyReturnsPanel() {
  const payload = usePayload();
  const { block: cmp, key: cmpKey } = useActiveComparator();
  const stratYearly = payload.strategyMetrics.yearly;
  const benchYearly: Record<string, number> = {};
  if (cmpKey !== "none" && Array.isArray(cmp.dailyReturns)) {
    for (let i = 0; i < payload.dates.length; i++) {
      const r = cmp.dailyReturns[i];
      if (!Number.isFinite(r)) continue;
      const yr = payload.dates[i].slice(0, 4);
      benchYearly[yr] = benchYearly[yr] == null ? r : (1 + benchYearly[yr]) * (1 + r) - 1;
    }
  }
  const hasBench = cmpKey !== "none";
  const years = Array.from(new Set([...Object.keys(stratYearly), ...Object.keys(benchYearly)])).sort();
  if (years.length === 0) return null;
  return (
    <Panel title="EOY Returns" benchHeader={hasBench ? cmp.shortName : undefined}>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-2 text-left font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">Year</th>
            <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">Strategy</th>
            {hasBench && (
              <>
                <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
                  {cmp.shortName}
                </th>
                <th className="py-1 pl-2 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">Δ</th>
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
    </Panel>
  );
}
