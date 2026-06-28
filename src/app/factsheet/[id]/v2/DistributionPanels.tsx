"use client";

import { useMemo } from "react";
import { usePayload, useActiveComparator } from "./factsheet-context";
import { ResponsiveChartFrame } from "@/components/ResponsiveChartFrame";
import { useBreakpoint } from "@/hooks/useBreakpoint";

/**
 * Three compact analytical panels sharing a common visual language:
 *
 *   - EndOfYearBarsPanel: horizontal bars, one per calendar year, scaled to
 *     the widest absolute return. Positive teal / negative red. Right-justified
 *     percentage labels alongside the bars.
 *
 *   - QuantileBoxPlotPanel: 5-number summary on the daily-return distribution
 *     drawn as a horizontal box-and-whisker with min/max whiskers, P25-P75 box,
 *     and P50 median line. Mean dot for reference.
 *
 *   - CorrelationStripPanel: ρ vs each available benchmark as a centred
 *     horizontal bar from −1 to +1. The mockup callout reads as a diversification
 *     story when all ρ cluster near zero.
 *
 * All three use real data — no demo badges.
 */

/* -------------------- EOY bars -------------------- */

export function EndOfYearBarsPanel() {
  const payload = usePayload();
  const { block: cmp, key: cmpKey } = useActiveComparator();
  const isMobile = useBreakpoint() === "mobile";
  const hasBench = cmpKey !== "none" && Array.isArray(cmp.dailyReturns);

  // Strategy per-year compounded — already pre-aggregated server-side.
  const stratByYear = payload.strategyMetrics.yearly;
  // Comparator per-year — compound the aligned daily-return series client-side.
  // Doing it here keeps the comparator picker reactive without a payload trip.
  const benchByYear = useMemo(() => {
    const out: Record<string, number> = {};
    if (!hasBench || !cmp.dailyReturns) return out;
    for (let i = 0; i < payload.dates.length; i++) {
      const r = cmp.dailyReturns[i];
      if (!Number.isFinite(r)) continue;
      const yr = payload.dates[i].slice(0, 4);
      out[yr] = out[yr] == null ? r : (1 + out[yr]) * (1 + r) - 1;
    }
    return out;
  }, [hasBench, cmp.dailyReturns, payload.dates]);

  const rows = useMemo(() => {
    const years = new Set<string>([...Object.keys(stratByYear), ...Object.keys(benchByYear)]);
    return Array.from(years).sort().map(year => ({
      year,
      strat: stratByYear[year] ?? null,
      bench: hasBench ? (benchByYear[year] ?? null) : null,
    }));
  }, [stratByYear, benchByYear, hasBench]);

  const maxAbs = useMemo(() => {
    let m = 0.01;
    for (const r of rows) {
      if (r.strat != null) m = Math.max(m, Math.abs(r.strat));
      if (r.bench != null) m = Math.max(m, Math.abs(r.bench));
    }
    return m;
  }, [rows]);
  if (rows.length === 0) return null;

  const VB_W = 880;
  // Wider rows when paired with benchmark — two bars + a thin gap need vertical room.
  // CHART-03 portrait: at mobile each row gets more vertical room (taller viewBox
  // = larger effective label px at 320px); desktop ROW_H/BAR_H = today's literals.
  const ROW_H = isMobile ? (hasBench ? 44 : 34) : hasBench ? 30 : 22;
  const BAR_H = isMobile ? (hasBench ? 14 : 22) : hasBench ? 11 : 16;
  const PAD = { top: 26, right: 80, bottom: 12, left: 60 };
  const plotW = VB_W - PAD.left - PAD.right;
  const VB_H = PAD.top + rows.length * ROW_H + PAD.bottom;
  const zeroX = PAD.left + plotW / 2;
  // CHART-02 legibility: mobile font-bumps; desktop arms = today's literals.
  const legendFont = isMobile ? 16 : 10;
  const yearFont = isMobile ? 18 : 11;
  const stratValFont = isMobile ? 18 : 11;
  const benchValFont = isMobile ? 16 : 10;

  return (
    <figure className="flex flex-col gap-2" style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${VB_H + 60}px` }}>
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          {hasBench ? `End-of-Year Returns vs ${cmp.shortName}` : "End-of-Year Returns"}
        </h3>
        <p className="text-[11px] text-text-muted">
          compounded annual returns · scale ±{(maxAbs * 100).toFixed(0)}%
          {hasBench ? ` · strategy in accent, ${cmp.shortName} in muted` : ""}
        </p>
      </header>
      <ResponsiveChartFrame
        width={VB_W}
        height={VB_H}
        role="img"
        aria-label={hasBench ? `End-of-year returns by calendar year, strategy vs ${cmp.shortName}` : "End-of-year returns by calendar year"}
      >
        {/* Legend */}
        <g>
          <rect x={PAD.left} y={6} width={10} height={6} fill="var(--color-accent)" />
          <text x={PAD.left + 14} y={12} fontSize={legendFont} fontFamily="var(--font-mono)" fill="var(--color-text-2)">
            {payload.strategyName}
          </text>
          {hasBench && (
            <>
              <rect x={PAD.left + 180} y={6} width={10} height={6} fill="var(--color-text-muted)" />
              <text x={PAD.left + 194} y={12} fontSize={legendFont} fontFamily="var(--font-mono)" fill="var(--color-text-2)">
                {cmp.name}
              </text>
            </>
          )}
        </g>
        {/* Center axis */}
        <line x1={zeroX} y1={PAD.top - 4} x2={zeroX} y2={VB_H - PAD.bottom} stroke="var(--color-text)" strokeWidth={1} />
        {rows.map((r, i) => {
          const cy = PAD.top + i * ROW_H + ROW_H / 2;
          // Year label
          return (
            <g key={r.year}>
              <text
                x={PAD.left - 8}
                y={cy + 4}
                textAnchor="end"
                fontSize={yearFont}
                fontFamily="var(--font-mono)"
                fill="var(--color-text-2)"
              >
                {r.year}
              </text>
              {r.strat != null && (() => {
                const halfW = (Math.abs(r.strat) / maxAbs) * (plotW / 2);
                const isPos = r.strat >= 0;
                const x = isPos ? zeroX : zeroX - halfW;
                const sy = hasBench ? cy - BAR_H - 1 : cy - BAR_H / 2;
                return (
                  <rect
                    x={x}
                    y={sy}
                    width={halfW}
                    height={BAR_H}
                    fill="var(--color-accent)"
                    fillOpacity={0.9}
                  />
                );
              })()}
              {hasBench && r.bench != null && (() => {
                const halfW = (Math.abs(r.bench) / maxAbs) * (plotW / 2);
                const isPos = r.bench >= 0;
                const x = isPos ? zeroX : zeroX - halfW;
                return (
                  <rect
                    x={x}
                    y={cy + 1}
                    width={halfW}
                    height={BAR_H}
                    fill="var(--color-text-muted)"
                    fillOpacity={0.7}
                  />
                );
              })()}
              {/* Right-edge labels: strategy value (accent), benchmark delta if present */}
              {r.strat != null && (
                <text
                  x={PAD.left + plotW + 6}
                  y={hasBench ? cy - 2 : cy + 4}
                  textAnchor="start"
                  fontSize={stratValFont}
                  fontFamily="var(--font-mono)"
                  fill="var(--color-text-primary)"
                >
                  {pctSigned(r.strat)}
                </text>
              )}
              {hasBench && r.bench != null && (
                <text
                  x={PAD.left + plotW + 6}
                  y={cy + 11}
                  textAnchor="start"
                  fontSize={benchValFont}
                  fontFamily="var(--font-mono)"
                  fill="var(--color-text-muted)"
                >
                  {pctSigned(r.bench)}
                </text>
              )}
            </g>
          );
        })}
      </ResponsiveChartFrame>
    </figure>
  );
}

/* -------------------- Quantile box plot -------------------- */

export function QuantileBoxPlotPanel() {
  const payload = usePayload();
  const isMobile = useBreakpoint() === "mobile";
  const q = payload.quantiles;
  // Use min/max as the visible range; clamp at twice the P95-P05 IQR-ish so
  // a 50% tail-event day doesn't push the box into a tiny sliver.
  const span = Math.max(Math.abs(q.p95 - q.p05), 0.005);
  const lo = Math.max(q.min, q.p05 - span * 1.5);
  const hi = Math.min(q.max, q.p95 + span * 1.5);
  const VB_W = 880;
  // CHART-03 portrait: taller mobile viewBox; desktop VB_H = today's literal (130).
  const VB_H = isMobile ? 200 : 130;
  // CHART-02 legibility: mobile font-bumps; desktop arms = today's literals (9 / 10).
  const refLabelFont = isMobile ? 16 : 9;
  const axisTickFont = isMobile ? 16 : 10;
  const PAD = { top: 30, right: 30, bottom: 26, left: 30 };
  const plotW = VB_W - PAD.left - PAD.right;
  const cy = PAD.top + (VB_H - PAD.top - PAD.bottom) / 2;
  const X = (v: number) => PAD.left + ((v - lo) / (hi - lo || 1)) * plotW;
  const boxTop = cy - 22;
  const boxBot = cy + 22;
  const whiskerTop = cy - 14;
  const whiskerBot = cy + 14;
  const ticks: { value: number; label: string }[] = [
    { value: lo, label: pctSigned(lo) },
    ...(lo < 0 && hi > 0 ? [{ value: 0, label: "0%" }] : []),
    { value: hi, label: pctSigned(hi) },
  ];

  return (
    <figure className="flex flex-col gap-2" style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${VB_H + 60}px` }}>
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Daily-Return Quantile Box
        </h3>
        <p className="text-[11px] text-text-muted">
          5-number summary · whiskers at min/max · box P25–P75 · median accent line
        </p>
      </header>
      <ResponsiveChartFrame
        width={VB_W}
        height={VB_H}
        role="img"
        aria-label="Quantile box plot for the strategy's daily return distribution"
      >
        {/* Centre line */}
        <line x1={PAD.left} y1={cy} x2={PAD.left + plotW} y2={cy} stroke="var(--color-text-muted)" strokeOpacity={0.3} strokeWidth={1} />
        {/* Whiskers from clamped min/max into the box */}
        <line x1={X(Math.max(q.min, lo))} y1={cy} x2={X(q.p25)} y2={cy} stroke="var(--color-text-2)" strokeWidth={1.2} />
        <line x1={X(q.p75)} y1={cy} x2={X(Math.min(q.max, hi))} y2={cy} stroke="var(--color-text-2)" strokeWidth={1.2} />
        {/* Whisker caps */}
        <line x1={X(Math.max(q.min, lo))} y1={whiskerTop} x2={X(Math.max(q.min, lo))} y2={whiskerBot} stroke="var(--color-text-2)" strokeWidth={1.2} />
        <line x1={X(Math.min(q.max, hi))} y1={whiskerTop} x2={X(Math.min(q.max, hi))} y2={whiskerBot} stroke="var(--color-text-2)" strokeWidth={1.2} />
        {/* P25-P75 box */}
        <rect
          x={X(q.p25)}
          y={boxTop}
          width={Math.max(0, X(q.p75) - X(q.p25))}
          height={boxBot - boxTop}
          fill="var(--color-accent)"
          fillOpacity={0.15}
          stroke="var(--color-accent)"
          strokeWidth={1}
        />
        {/* Median line inside the box */}
        <line
          x1={X(q.p50)}
          y1={boxTop}
          x2={X(q.p50)}
          y2={boxBot}
          stroke="var(--color-accent)"
          strokeWidth={2}
        />
        {/* Mean as a small open circle */}
        <circle cx={X(q.mean)} cy={cy} r={3.5} fill="none" stroke="var(--color-text-primary)" strokeWidth={1.4} />
        {/* P05/P95 dashed reference lines */}
        <line x1={X(q.p05)} y1={cy - 18} x2={X(q.p05)} y2={cy + 18} stroke="var(--color-text-muted)" strokeDasharray="2 2" strokeWidth={1} />
        <line x1={X(q.p95)} y1={cy - 18} x2={X(q.p95)} y2={cy + 18} stroke="var(--color-text-muted)" strokeDasharray="2 2" strokeWidth={1} />
        {/* P05/P95 labels above */}
        <text x={X(q.p05)} y={cy - 22} textAnchor="middle" fontSize={refLabelFont} fontFamily="var(--font-mono)" fill="var(--color-text-muted)">
          P5 {pctSigned(q.p05)}
        </text>
        <text x={X(q.p95)} y={cy - 22} textAnchor="middle" fontSize={refLabelFont} fontFamily="var(--font-mono)" fill="var(--color-text-muted)">
          P95 {pctSigned(q.p95)}
        </text>
        {/* Axis ticks */}
        {ticks.map(t => (
          <g key={`xt-${t.value}`}>
            <line x1={X(t.value)} y1={VB_H - PAD.bottom + 4} x2={X(t.value)} y2={VB_H - PAD.bottom} stroke="var(--color-text-muted)" strokeWidth={1} />
            <text
              x={X(t.value)}
              y={VB_H - PAD.bottom + 16}
              textAnchor="middle"
              fontSize={axisTickFont}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {t.label}
            </text>
          </g>
        ))}
      </ResponsiveChartFrame>
      <div className="grid grid-cols-5 gap-3 text-[11px] tabular-nums font-mono mt-1">
        <Kpi label="P5" value={pctSigned(q.p05)} tone="muted" />
        <Kpi label="P25" value={pctSigned(q.p25)} tone="muted" />
        <Kpi label="Median" value={pctSigned(q.p50)} tone="accent" />
        <Kpi label="P75" value={pctSigned(q.p75)} tone="muted" />
        <Kpi label="P95" value={pctSigned(q.p95)} tone="muted" />
      </div>
    </figure>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "muted" | "accent" }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.18em] text-text-muted">{label}</p>
      <p
        className="text-[13px]"
        style={{ color: tone === "accent" ? "var(--color-accent)" : "var(--color-text-primary)", fontWeight: 600 }}
      >
        {value}
      </p>
    </div>
  );
}

/* -------------------- Correlation strip -------------------- */

export function CorrelationStripPanel() {
  const payload = usePayload();
  const isMobile = useBreakpoint() === "mobile";
  const rows = payload.correlations.filter(r => Number.isFinite(r.rho));
  if (rows.length === 0) return null;
  const VB_W = 880;
  // CHART-03 portrait: taller mobile rows; desktop ROW_H = today's literal (26).
  const ROW_H = isMobile ? 40 : 26;
  const PAD = { top: 30, right: 70, bottom: 18, left: 110 };
  const plotW = VB_W - PAD.left - PAD.right;
  const VB_H = PAD.top + rows.length * ROW_H + PAD.bottom;
  const zeroX = PAD.left + plotW / 2;
  const X = (rho: number) => PAD.left + ((rho + 1) / 2) * plotW;
  // CHART-02 legibility: fewer ticks + bigger font at mobile; desktop = today's
  // 5-tick literal set and font literals (10 / 11).
  const ticks = isMobile ? [-1, 0, 1] : [-1, -0.5, 0, 0.5, 1];
  const tickFont = isMobile ? 16 : 10;
  const nameFont = isMobile ? 16 : 11;
  const rhoFont = isMobile ? 16 : 11;

  return (
    <figure className="flex flex-col gap-2" style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${VB_H + 60}px` }}>
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Cross-Asset Correlation
        </h3>
        <p className="text-[11px] text-text-muted">
          Pearson ρ on aligned daily returns · ρ near 0 implies diversification benefit
        </p>
      </header>
      <ResponsiveChartFrame
        width={VB_W}
        height={VB_H}
        role="img"
        aria-label="Cross-asset correlations between strategy and major benchmarks"
      >
        {/* Top tick band */}
        {ticks.map(t => (
          <g key={`tk-${t}`}>
            <line
              x1={X(t)}
              y1={PAD.top - 6}
              x2={X(t)}
              y2={VB_H - PAD.bottom}
              stroke="var(--color-border)"
              strokeDasharray={t === 0 ? "3 2" : "2 3"}
              strokeWidth={1}
            />
            <text
              x={X(t)}
              y={PAD.top - 10}
              textAnchor="middle"
              fontSize={tickFont}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        {/* Each correlation as a centre-zero bar */}
        {rows.map((r, i) => {
          const cy = PAD.top + i * ROW_H + ROW_H / 2;
          const halfW = (Math.abs(r.rho) / 1) * (plotW / 2);
          const isPos = r.rho >= 0;
          const x = isPos ? zeroX : zeroX - halfW;
          const fill = Math.abs(r.rho) > 0.2 ? "var(--color-accent)" : "var(--color-text-muted)";
          return (
            <g key={r.name}>
              <text
                x={PAD.left - 8}
                y={cy + 4}
                textAnchor="end"
                fontSize={nameFont}
                fontFamily="var(--font-sans)"
                fill="var(--color-text-2)"
              >
                {r.name}
              </text>
              <rect x={x} y={cy - 9} width={halfW} height={18} fill={fill} fillOpacity={0.85} />
              <text
                x={PAD.left + plotW + 6}
                y={cy + 4}
                textAnchor="start"
                fontSize={rhoFont}
                fontFamily="var(--font-mono)"
                fill="var(--color-text-primary)"
              >
                {signedNum(r.rho)}
              </text>
            </g>
          );
        })}
      </ResponsiveChartFrame>
      <p className="text-[10px] italic text-text-muted">
        ρ measured against the strategy&apos;s observation dates with each benchmark forward-filled to the same calendar.
      </p>
    </figure>
  );
}

/* -------------------- Correlations matrix -------------------- */

/**
 * Full pairwise correlation heatmap across the strategy + all benchmarks.
 * Mockup-faithful diagonal-symmetric square. Background tinted by ρ
 * magnitude (teal positive / red negative); diagonal cells render as accent
 * filled with 1.00 in white text. Numeric labels stay inside every cell so
 * the matrix doubles as a small data table.
 */
export function CorrelationsMatrixPanel() {
  const payload = usePayload();
  const isMobile = useBreakpoint() === "mobile";
  const { labels, matrix } = payload.correlationMatrix;
  if (labels.length === 0) return null;

  const N = labels.length;
  // CHART-03 keep-all-cells: cell COUNT is data-driven (N×N) at every breakpoint —
  // never sliced/dropped. The dense matrix stays inside the existing
  // overflow-x-auto scroll region; at mobile we only enlarge each cell + bump the
  // label fonts so every cell label clears the legibility floor inside the scroll.
  // Desktop cell/label dims = today's literals (88 / 36 / 110 / 11 / 12).
  const CELL_W = isMobile ? 104 : 88;
  const CELL_H = isMobile ? 48 : 36;
  const LABEL_W = isMobile ? 128 : 110;
  const HEADER_H = 28;
  const headerFont = isMobile ? 16 : 11;
  const rowLabelFont = isMobile ? 16 : 11;
  const cellFont = isMobile ? 17 : 12;
  const W = LABEL_W + N * CELL_W + 6;
  const H = HEADER_H + N * CELL_H + 6;

  return (
    <figure
      className="flex flex-col gap-2"
      style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${H + 60}px` }}
    >
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Returns Correlations
        </h3>
        <p className="text-[11px] text-text-muted">
          Pearson ρ on aligned daily returns · diagonal = 1.00 · pairwise off-diagonal
        </p>
      </header>
      <div className="overflow-x-auto">
        {/* CHART-03 keep-all-cells: the matrix stays a horizontally-scrolling SVG
            (minWidth=W inside overflow-x-auto) rather than a fit-to-width chart,
            so no row/col is ever dropped at 320px. The responsive style keys are
            overridden on the frame to restore that scroll recipe (width:100% +
            minWidth + height:auto, no aspect-ratio cap). */}
        <ResponsiveChartFrame
          width={W}
          height={H}
          role="img"
          aria-label="Pairwise correlation matrix of strategy and benchmarks"
          style={{ display: "block", width: "100%", height: "auto", minWidth: W, aspectRatio: "auto", maxHeight: "none" }}
          shapeRendering="crispEdges"
        >
          {/* Column headers */}
          {labels.map((lbl, j) => (
            <text
              key={`ch-${j}`}
              x={LABEL_W + j * CELL_W + CELL_W / 2}
              y={HEADER_H - 8}
              textAnchor="middle"
              fontSize={headerFont}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-2)"
            >
              {lbl}
            </text>
          ))}
          {/* Header underline */}
          <line x1={LABEL_W} x2={W - 6} y1={HEADER_H - 2} y2={HEADER_H - 2} stroke="var(--color-text)" strokeWidth={1} />
          {/* Row labels + cells */}
          {labels.map((rowLbl, i) => (
            <g key={`r-${i}`}>
              <text
                x={LABEL_W - 8}
                y={HEADER_H + i * CELL_H + CELL_H / 2 + 4}
                textAnchor="end"
                fontSize={rowLabelFont}
                fontFamily="var(--font-mono)"
                fill="var(--color-text-2)"
              >
                {rowLbl}
              </text>
              {matrix[i].map((rho, j) => {
                const x = LABEL_W + j * CELL_W;
                const y = HEADER_H + i * CELL_H;
                const isDiag = i === j;
                const tint = matrixTint(rho, isDiag);
                return (
                  <g key={`c-${i}-${j}`}>
                    <rect
                      x={x + 1}
                      y={y + 1}
                      width={CELL_W - 2}
                      height={CELL_H - 2}
                      fill={tint.bg}
                      stroke="var(--color-border)"
                      strokeWidth={0.5}
                    />
                    <text
                      x={x + CELL_W / 2}
                      y={y + CELL_H / 2 + 4}
                      textAnchor="middle"
                      fontSize={cellFont}
                      fontFamily="var(--font-mono)"
                      fill={tint.fg}
                      fontWeight={isDiag ? 600 : 500}
                    >
                      {Number.isFinite(rho) ? rho.toFixed(2) : "—"}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
        </ResponsiveChartFrame>
      </div>
    </figure>
  );
}

function matrixTint(rho: number, isDiag: boolean): { bg: string; fg: string } {
  if (isDiag) return { bg: "var(--color-accent)", fg: "#FFFFFF" };
  if (!Number.isFinite(rho)) return { bg: "var(--color-surface-subtle, #FBFCFD)", fg: "var(--color-text-muted)" };
  // Tint magnitude scales |ρ|. Strong correlations (|ρ| > 0.5) darken the bg
  // so high-correlation cells stand out at a glance.
  const a = Math.min(1, Math.abs(rho) * 1.2);
  if (rho >= 0) {
    const bg = mixRgb([255, 255, 255], [27, 107, 90], a);
    const fg = a > 0.55 ? "#FFFFFF" : "var(--color-text-primary)";
    return { bg, fg };
  }
  const bg = mixRgb([255, 255, 255], [220, 38, 38], a);
  const fg = a > 0.55 ? "#FFFFFF" : "var(--color-text-primary)";
  return { bg, fg };
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

/* -------------------- Format helpers -------------------- */

function pctSigned(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const x = v * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;
}

function signedNum(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}
