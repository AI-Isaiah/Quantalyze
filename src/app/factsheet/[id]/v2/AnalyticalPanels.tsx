"use client";

import { usePayload } from "./factsheet-context";
import { useBasisSeriesView } from "./basis-context";
import { ResponsiveChartFrame } from "@/components/ResponsiveChartFrame";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useTapPin } from "@/hooks/useTapPin";

/**
 * Three analytical panels rounding out the v2 page:
 *   - StreakDistributionPanel: two side-by-side histograms (winning vs
 *     losing run length). Lives in the left/chart column.
 *   - CalmarByYearPanel: per-year stability table.
 *   - BootstrapCIPanel: 95% CIs on the three headline ratios.
 *
 * All three use real strategy data — no demo badges needed.
 *
 * Phase 47 (CHART-01a/02/03): StreakHist gets touch tap-reveal/pin via the
 * shared `useTapPin` hook — a tap reveals (and pins) the SAME value the desktop
 * per-bar `<title>` shows; the desktop hover path + desktop render stay
 * byte-identical (every tuning change is gated behind `isMobile`, desktop arm =
 * today's literal). BootstrapCIPanel (no hover) gets legibility + portrait only.
 */

const VB_W = 440;
// Desktop viewBox height is today's literal (200). Mobile is taller for a
// portrait-friendly aspect at 320px (CHART-03). The width axis (VB_W) is fixed.
const VB_H_DESKTOP = 200;
const VB_H_MOBILE = 280;
const HIST_PAD = { top: 14, right: 16, bottom: 26, left: 42 };

export function StreakDistributionPanel() {
  // Phase 103 (MTM-04): consecutive-day streaks derive from the strategy's own
  // daily-return signs → follow the active basis (cash view === payload).
  const view = useBasisSeriesView(usePayload());
  const s = view.streaks;
  return (
    <figure
      className="@container flex flex-col gap-2"
      style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${VB_H_DESKTOP + 80}px` }}
    >
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Consecutive-Day Streak Distribution
        </h3>
        <p className="text-micro text-text-muted">
          {s.totalWins.toLocaleString()} winning streaks · {s.totalLosses.toLocaleString()} losing streaks · max win
          streak {s.longestWin}d · max loss streak {s.longestLoss}d
        </p>
      </header>
      {/* Phase 52-06 / TYPE-04: single-column when the PANEL is narrow so each
          StreakHist renders ~288px wide → the coarse hit-rect's colW=76 viewBox
          units land ≈49 CSS px (CR-01). The split now keys off the panel's OWN
          width (`@container` on the figure, `@2xl:grid-cols-2` at ≈42rem) rather
          than the viewport `sm:` breakpoint — bare inline-size @container
          (Pitfall 1). The single-column collapse stays load-bearing for the touch
          hit-rect scale; useBreakpoint/useTapPin (frozen islands) are untouched. */}
      <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-4 mt-2">
        <StreakHist title="Wins" data={s.winsByLength} color="var(--color-positive)" maxLen={s.maxLen} />
        <StreakHist title="Losses" data={s.lossesByLength} color="var(--color-negative)" maxLen={s.maxLen} />
      </div>
    </figure>
  );
}

/** The exact desktop `<title>` copy for a streak bar — the single value source
 *  that BOTH the desktop hover `<title>` AND the touch pinned reveal show. */
function streakLabel(i: number, c: number, maxLen: number): string {
  return `Length ${i + 1}${i + 1 === maxLen ? "+" : ""}: ${c} streak${c === 1 ? "" : "s"}`;
}

function StreakHist({ title, data, color, maxLen }: { title: string; data: number[]; color: string; maxLen: number }) {
  const isMobile = useBreakpoint() === "mobile";
  // Desktop branch = today's literals (byte-identical). Mobile bumps the axis
  // font (CHART-02: 9px at VB_W=440 lands ~5.9px effective at 320px) + reduces
  // x-tick density + uses a taller viewBox (CHART-03 portrait).
  const VB_H = isMobile ? VB_H_MOBILE : VB_H_DESKTOP;
  const axisFont = isMobile ? 18 : 9;
  const plotW = VB_W - HIST_PAD.left - HIST_PAD.right;
  const plotH = VB_H - HIST_PAD.top - HIST_PAD.bottom;
  const maxCount = Math.max(1, ...data);
  const barW = plotW / maxLen;
  // Nice-rounded Y ticks: 4 evenly-spaced count levels capped to the data max.
  const yTicks = niceCountTicks(0, maxCount, 4);
  const yPx = (c: number) => HIST_PAD.top + plotH - (c / Math.max(1, yTicks[yTicks.length - 1].value || maxCount)) * plotH;

  // x-tick lengths: every other length on desktop (today's set); on mobile show
  // fewer so each fits the bumped font — endpoints + the midpoint + the max.
  const allLengths = Array.from({ length: maxLen }, (_, i) => i + 1);
  const xTickLengths = isMobile
    ? allLengths.filter(n => n === 1 || n === Math.ceil(maxLen / 2) || n === maxLen)
    : allLengths.filter(n => n % 2 === 1 || n === maxLen);

  // Touch tap-reveal/pin: map the pointer x to a bar index over the plot region;
  // the hook owns slop/time/touch-only/re-tap/leave. Desktop mouse keeps its
  // native per-bar <title> hover (the hook only fires for pointerType "touch").
  const pointerToIndex = (clientX: number, _clientY: number, rect: DOMRect): number | null => {
    const vbX = ((clientX - rect.left) / rect.width) * VB_W;
    const i = Math.floor((vbX - HIST_PAD.left) / barW);
    if (i < 0 || i >= data.length) return null;
    return i;
  };
  const { selectedIdx, setChartEl, onPointerDown, onPointerMove, onPointerUp, onPointerLeave } =
    useTapPin({ count: data.length, pointerToIndex });
  const selected =
    selectedIdx != null && selectedIdx >= 0 && selectedIdx < data.length ? selectedIdx : null;

  return (
    <div>
      <p className="text-micro font-mono uppercase tracking-wider text-text-muted mb-1">{title}</p>
      <ResponsiveChartFrame
        ref={setChartEl}
        width={VB_W}
        height={VB_H}
        role="img"
        aria-label={
          isMobile
            ? `${title} streak-length distribution — tap a bar to reveal its count`
            : `${title} streak-length distribution`
        }
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        {/* Y gridlines + labels */}
        {yTicks.map(t => (
          <g key={`y-${t.value}`}>
            <line
              x1={HIST_PAD.left}
              x2={HIST_PAD.left + plotW}
              y1={yPx(t.value)}
              y2={yPx(t.value)}
              stroke="var(--color-border)"
              strokeDasharray={t.value === 0 ? undefined : "2 3"}
              strokeWidth={1}
            />
            <text
              x={HIST_PAD.left - 4}
              y={yPx(t.value) + 3}
              textAnchor="end"
              fontSize={axisFont}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {t.label}
            </text>
          </g>
        ))}
        {data.map((c, i) => {
          const h = HIST_PAD.top + plotH - yPx(c);
          if (h === 0) return null;
          const x = HIST_PAD.left + i * barW;
          return (
            <rect
              key={i}
              x={x + 0.5}
              y={yPx(c)}
              width={Math.max(0, barW - 1)}
              height={h}
              fill={color}
              fillOpacity={selected === i ? 1 : 0.85}
            >
              <title>{streakLabel(i, c, maxLen)}</title>
            </rect>
          );
        })}
        {/* Pointer-coarse-ONLY ≥44px tap targets: one invisible interaction
            <rect> per bar, spanning the full plot height. `hidden
            pointer-coarse:block` keeps them off pointer-fine (desktop hover via
            the bar <title> stays byte-identical) and present on touch. The
            column is widened to ≥76 viewBox units. The ACTUAL mobile scale: the
            parent grid collapses to a single column below sm (CR-01), so each
            histogram renders ~288 CSS px wide against VB_W=440 → scale ≈
            288/440 ≈ 0.65×, giving 76 × 0.65 ≈ 49 CSS px — clears the 44px WCAG
            target with ~5px margin so intermediate padding / a scrollbar / a
            sub-320px device doesn't silently drop it below 44px. On a 2-col
            mobile grid the scale would be ~0.32× and the hit-rect ~24px — hence
            the single-column collapse is load-bearing.
            The visible bar width is unchanged — this layer is geometry-only. */}
        {data.map((_, i) => {
          const colW = Math.max(barW, 76);
          const cx = HIST_PAD.left + i * barW + barW / 2;
          return (
            <rect
              key={`hit-${i}`}
              className="hidden pointer-coarse:block"
              x={cx - colW / 2}
              y={HIST_PAD.top}
              width={colW}
              height={plotH}
              fill="transparent"
            />
          );
        })}
        {/* X-axis ticks */}
        {xTickLengths.map(n => {
          const x = HIST_PAD.left + (n - 0.5) * barW;
          return (
            <g key={`tick-${n}`}>
              <line
                x1={x}
                x2={x}
                y1={HIST_PAD.top + plotH}
                y2={HIST_PAD.top + plotH + 3}
                stroke="var(--color-text-muted)"
                strokeWidth={1}
              />
              <text
                x={x}
                y={HIST_PAD.top + plotH + 14}
                textAnchor="middle"
                fontSize={axisFont}
                fontFamily="var(--font-mono)"
                fill="var(--color-text-muted)"
              >
                {n === maxLen ? `${n}+` : n}
              </text>
            </g>
          );
        })}
        {/* Touch pinned reveal — shows the SAME copy the per-bar <title> shows
            (no new format/accent). Rendered only when a bar is tap-selected. */}
        {selected != null && (
          <g data-tap-reveal="streak" pointerEvents="none">
            <text
              x={VB_W / 2}
              y={HIST_PAD.top - 2}
              textAnchor="middle"
              fontSize={Math.max(12, axisFont)}
              fontFamily="var(--font-mono)"
              fontWeight={600}
              fill="var(--color-text-primary)"
            >
              {streakLabel(selected, data[selected], maxLen)}
            </text>
          </g>
        )}
      </ResponsiveChartFrame>
    </div>
  );
}

/** Integer Y-axis ticks for count data — rounds the upper bound to a nice round number. */
function niceCountTicks(lo: number, hi: number, count: number): { value: number; label: string }[] {
  if (hi <= lo) return [{ value: 0, label: "0" }];
  const rough = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rough)) || 0));
  const norm = rough / mag;
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  const step = Math.max(1, Math.round(nice * mag));
  const ceil = Math.ceil(hi / step) * step;
  const out: { value: number; label: string }[] = [];
  for (let v = 0; v <= ceil + step * 0.001 && out.length < 8; v += step) {
    out.push({ value: v, label: String(Math.round(v)) });
  }
  return out;
}

export function CalmarByYearPanel() {
  // Phase 103 (MTM-04): per-year Calmar recomputes from the strategy's own daily
  // series → follows the active basis (cash view === payload).
  const view = useBasisSeriesView(usePayload());
  const rows = view.calmarByYear;
  if (rows.length === 0) return null;
  // Flag any partial-year row — < 200 trading days means Calmar is annualised
  // from a stub and shouldn't be treated as comparable to a full-year value.
  const hasPartial = rows.some(r => r.days < 200);
  return (
    <section>
      <header className="mb-2 border-b border-text pb-1">
        <h3 className="text-small font-semibold uppercase tracking-wider text-text-primary">Calmar by Year</h3>
      </header>
      <table className="w-full text-micro">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-2 text-left font-mono text-micro uppercase tracking-wider text-text-muted">Year</th>
            <th className="py-1 px-2 text-right font-mono text-micro uppercase tracking-wider text-text-muted">Return</th>
            <th className="py-1 px-2 text-right font-mono text-micro uppercase tracking-wider text-text-muted">Max DD</th>
            <th className="py-1 px-2 text-right font-mono text-micro uppercase tracking-wider text-text-muted">Calmar</th>
            <th className="py-1 pl-2 text-right font-mono text-micro uppercase tracking-wider text-text-muted">Days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const partial = r.days < 200;
            return (
              <tr key={r.year} className="border-b border-border/30 last:border-0">
                <td className="py-1 pr-2 font-mono text-text-2">
                  {r.year}
                  {partial && (
                    <span
                      className="ml-1 text-micro"
                      style={{ color: "var(--color-warning, #B45309)" }}
                      title={`Only ${r.days} trading days — Calmar/return for this year is based on a partial sample`}
                    >
                      ⚠
                    </span>
                  )}
                </td>
                <td className="py-1 px-2 text-right font-mono tabular-nums text-text-primary">{pctSigned(r.ret)}</td>
                <td className="py-1 px-2 text-right font-mono tabular-nums text-text-primary">{pct(r.max_dd)}</td>
                <td className="py-1 px-2 text-right font-mono tabular-nums text-text-primary">{num(r.calmar)}</td>
                <td className="py-1 pl-2 text-right font-mono tabular-nums text-text-2">{r.days}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasPartial && (
        <p className="mt-2 text-micro italic text-text-muted">
          ⚠ Years with &lt; 200 trading days are partial — Calmar values are not comparable to full-year rows.
        </p>
      )}
    </section>
  );
}

export function BootstrapCIPanel() {
  // Phase 103 (MTM-04): the bootstrap CIs resample the strategy's own daily series
  // → follow the active basis. `strategyMetrics` is NOT in the bundle, so
  // `view.strategyMetrics.n` passes through as the CASH observation count (the
  // KpiStrip owns MTM there, Phase 102) — the low-N warning stays cash-coarse.
  const view = useBasisSeriesView(usePayload());
  const b = view.bootstrapCI;
  const lowN = view.strategyMetrics.n < 252;
  return (
    <section>
      <header className="mb-2 border-b border-text pb-1">
        <h3 className="text-small font-semibold uppercase tracking-wider text-text-primary">Bootstrap 95% Confidence</h3>
      </header>
      {lowN && (
        <p className="mb-2 text-micro italic" style={{ color: "var(--color-warning, #B45309)" }}>
          ⚠ Bootstrap resamples are drawn from {view.strategyMetrics.n} observations.
          CI width is wide and may understate true uncertainty below 252 days (1 year).
        </p>
      )}
      <table className="w-full text-micro">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-2 text-left font-mono text-micro uppercase tracking-wider text-text-muted">Metric</th>
            <th className="py-1 px-2 text-right font-mono text-micro uppercase tracking-wider text-text-muted">Point</th>
            <th className="py-1 pl-2 text-right font-mono text-micro uppercase tracking-wider text-text-muted">95% CI</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Sharpe" point={num(b.sharpe.point)} ci={`[${num(b.sharpe.lo)}, ${num(b.sharpe.hi)}]`} />
          <Row label="Sortino" point={num(b.sortino.point)} ci={`[${num(b.sortino.lo)}, ${num(b.sortino.hi)}]`} />
          <Row label="Max Drawdown" point={pct(b.max_dd.point)} ci={`[${pct(b.max_dd.lo)}, ${pct(b.max_dd.hi)}]`} />
        </tbody>
      </table>

      {/* Resample-distribution sparklines — show the SHAPE of the bootstrap
          density, not just the CI bounds. Sharpe = primary (accent), Sortino
          + Max-DD stacked below in muted tones. */}
      <div className="mt-3 flex flex-col gap-2.5">
        <BootHist title="Sharpe" hist={b.sharpe.hist} point={b.sharpe.point} ci={[b.sharpe.lo, b.sharpe.hi]} fmt={n => n.toFixed(2)} accent />
        <BootHist title="Sortino" hist={b.sortino.hist} point={b.sortino.point} ci={[b.sortino.lo, b.sortino.hi]} fmt={n => n.toFixed(2)} />
        <BootHist title="Max DD" hist={b.max_dd.hist} point={b.max_dd.point} ci={[b.max_dd.lo, b.max_dd.hi]} fmt={n => `${(n * 100).toFixed(1)}%`} />
      </div>

      <p className="mt-2 text-micro italic text-text-muted">
        {b.n_resamples.toLocaleString()} stationary block-bootstrap resamples · {b.block_len}-day block length · 95% CI
      </p>
    </section>
  );
}

function BootHist({
  title,
  hist,
  point,
  ci,
  fmt,
  accent,
}: {
  title: string;
  hist: { lo: number; hi: number; bins: number[] };
  point: number;
  ci: [number, number];
  fmt: (n: number) => string;
  accent?: boolean;
}) {
  const isMobile = useBreakpoint() === "mobile";
  const W = 340;
  // Desktop height = today's literal (36). Mobile uses a taller strip so the CI
  // band + bars read at 320px (CHART-02/03 — no hover, so legibility + portrait
  // only). The width axis (W) is fixed → desktop render byte-identical.
  const H = isMobile ? 56 : 36;
  const PAD = { left: 4, right: 4, top: 4, bottom: 10 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const degenerate = hist.bins.length === 0 || hist.hi === hist.lo;
  const maxCount = degenerate ? 1 : Math.max(1, ...hist.bins);
  const barW = degenerate ? 0 : plotW / hist.bins.length;
  const span = hist.hi - hist.lo;
  const X = (v: number) => (span > 0 ? PAD.left + ((v - hist.lo) / span) * plotW : PAD.left + plotW / 2);
  const color = accent ? "var(--color-accent)" : "var(--color-text-muted)";
  if (degenerate) {
    return (
      <div>
        <div className="flex items-baseline justify-between text-micro font-mono uppercase tracking-[0.14em] text-text-muted">
          <span>{title}</span>
          <span className="normal-case tracking-normal text-text-muted">no variance</span>
        </div>
        <div className="h-[36px] flex items-center justify-center text-micro text-text-muted italic">
          all resamples produced {fmt(point)}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-baseline justify-between text-micro font-mono uppercase tracking-[0.14em] text-text-muted">
        <span>{title}</span>
        <span className="normal-case tracking-normal">
          <span className="text-text-2">{fmt(ci[0])}</span> ·{" "}
          <span className="text-text-primary font-semibold">{fmt(point)}</span> ·{" "}
          <span className="text-text-2">{fmt(ci[1])}</span>
        </span>
      </div>
      <ResponsiveChartFrame width={W} height={H} role="img" aria-label={`${title} bootstrap distribution`}>
        {/* CI shaded band */}
        <rect
          x={X(ci[0])}
          y={PAD.top}
          width={Math.max(0, X(ci[1]) - X(ci[0]))}
          height={plotH}
          fill={color}
          fillOpacity={0.08}
        />
        {hist.bins.map((c, i) => {
          if (c === 0) return null;
          const h = (c / maxCount) * plotH;
          return (
            <rect
              key={i}
              x={PAD.left + i * barW + 0.5}
              y={PAD.top + plotH - h}
              width={Math.max(0, barW - 1)}
              height={h}
              fill={color}
              fillOpacity={0.6}
            />
          );
        })}
        {/* Point estimate vertical line */}
        <line
          x1={X(point)}
          x2={X(point)}
          y1={PAD.top}
          y2={PAD.top + plotH + 2}
          stroke="var(--color-text-primary)"
          strokeWidth={1.4}
        />
      </ResponsiveChartFrame>
    </div>
  );
}

function Row({ label, point, ci }: { label: string; point: string; ci: string }) {
  return (
    <tr className="border-b border-border/30 last:border-0">
      <td className="py-1 pr-2 text-text-2">{label}</td>
      <td className="py-1 px-2 text-right font-mono tabular-nums text-text-primary">{point}</td>
      <td className="py-1 pl-2 text-right font-mono tabular-nums text-text-2">{ci}</td>
    </tr>
  );
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function pctSigned(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%";
}

function num(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(2);
}
