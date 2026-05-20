"use client";

import { usePayload } from "./factsheet-context";

/**
 * Three analytical panels rounding out the v2 page:
 *   - StreakDistributionPanel: two side-by-side histograms (winning vs
 *     losing run length). Lives in the left/chart column.
 *   - CalmarByYearPanel: per-year stability table.
 *   - BootstrapCIPanel: 95% CIs on the three headline ratios.
 *
 * All three use real strategy data — no demo badges needed.
 */

const VB_W = 440;
const VB_H = 200;
const HIST_PAD = { top: 14, right: 16, bottom: 26, left: 42 };

export function StreakDistributionPanel() {
  const payload = usePayload();
  const s = payload.streaks;
  return (
    <figure
      className="flex flex-col gap-2"
      style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${VB_H + 80}px` }}
    >
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Consecutive-Day Streak Distribution
        </h3>
        <p className="text-[11px] text-text-muted">
          {s.totalWins.toLocaleString()} winning streaks · {s.totalLosses.toLocaleString()} losing streaks · max win
          streak {s.longestWin}d · max loss streak {s.longestLoss}d
        </p>
      </header>
      <div className="grid grid-cols-2 gap-4 mt-2">
        <StreakHist title="Wins" data={s.winsByLength} color="var(--color-positive)" maxLen={s.maxLen} />
        <StreakHist title="Losses" data={s.lossesByLength} color="var(--color-negative)" maxLen={s.maxLen} />
      </div>
    </figure>
  );
}

function StreakHist({ title, data, color, maxLen }: { title: string; data: number[]; color: string; maxLen: number }) {
  const plotW = VB_W - HIST_PAD.left - HIST_PAD.right;
  const plotH = VB_H - HIST_PAD.top - HIST_PAD.bottom;
  const maxCount = Math.max(1, ...data);
  const barW = plotW / maxLen;
  // Nice-rounded Y ticks: 4 evenly-spaced count levels capped to the data max.
  const yTicks = niceCountTicks(0, maxCount, 4);
  const yPx = (c: number) => HIST_PAD.top + plotH - (c / Math.max(1, yTicks[yTicks.length - 1].value || maxCount)) * plotH;
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">{title}</p>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="block w-full"
        style={{ aspectRatio: `${VB_W} / ${VB_H}`, maxHeight: VB_H, width: "100%", height: "auto" }}
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
              fontSize={9}
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
              fillOpacity={0.85}
            >
              <title>{`Length ${i + 1}${i + 1 === maxLen ? "+" : ""}: ${c} streak${c === 1 ? "" : "s"}`}</title>
            </rect>
          );
        })}
        {/* X-axis ticks: every other length */}
        {Array.from({ length: maxLen }, (_, i) => i + 1)
          .filter(n => n % 2 === 1 || n === maxLen)
          .map(n => {
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
                  fontSize={9}
                  fontFamily="var(--font-mono)"
                  fill="var(--color-text-muted)"
                >
                  {n === maxLen ? `${n}+` : n}
                </text>
              </g>
            );
          })}
      </svg>
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
  const payload = usePayload();
  const rows = payload.calmarByYear;
  if (rows.length === 0) return null;
  // Flag any partial-year row — < 200 trading days means Calmar is annualised
  // from a stub and shouldn't be treated as comparable to a full-year value.
  const hasPartial = rows.some(r => r.days < 200);
  return (
    <section>
      <header className="mb-2 border-b border-text pb-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary">Calmar by Year</h3>
      </header>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-2 text-left font-mono text-[9px] uppercase tracking-wider text-text-muted">Year</th>
            <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-wider text-text-muted">Return</th>
            <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-wider text-text-muted">Max DD</th>
            <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-wider text-text-muted">Calmar</th>
            <th className="py-1 pl-2 text-right font-mono text-[9px] uppercase tracking-wider text-text-muted">Days</th>
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
                      className="ml-1 text-[9px]"
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
        <p className="mt-2 text-[10px] italic text-text-muted">
          ⚠ Years with &lt; 200 trading days are partial — Calmar values are not comparable to full-year rows.
        </p>
      )}
    </section>
  );
}

export function BootstrapCIPanel() {
  const payload = usePayload();
  const b = payload.bootstrapCI;
  const lowN = payload.strategyMetrics.n < 252;
  return (
    <section>
      <header className="mb-2 border-b border-text pb-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary">Bootstrap 95% Confidence</h3>
      </header>
      {lowN && (
        <p className="mb-2 text-[10px] italic" style={{ color: "var(--color-warning, #B45309)" }}>
          ⚠ Bootstrap resamples are drawn from {payload.strategyMetrics.n} observations.
          CI width is wide and may understate true uncertainty below 252 days (1 year).
        </p>
      )}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/60">
            <th className="py-1 pr-2 text-left font-mono text-[9px] uppercase tracking-wider text-text-muted">Metric</th>
            <th className="py-1 px-2 text-right font-mono text-[9px] uppercase tracking-wider text-text-muted">Point</th>
            <th className="py-1 pl-2 text-right font-mono text-[9px] uppercase tracking-wider text-text-muted">95% CI</th>
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

      <p className="mt-2 text-[10px] italic text-text-muted">
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
  const W = 340;
  const H = 36;
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
        <div className="flex items-baseline justify-between text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted">
          <span>{title}</span>
          <span className="normal-case tracking-normal text-text-muted">no variance</span>
        </div>
        <div className="h-[36px] flex items-center justify-center text-[10px] text-text-muted italic">
          all resamples produced {fmt(point)}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted">
        <span>{title}</span>
        <span className="normal-case tracking-normal">
          <span className="text-text-2">{fmt(ci[0])}</span> ·{" "}
          <span className="text-text-primary font-semibold">{fmt(point)}</span> ·{" "}
          <span className="text-text-2">{fmt(ci[1])}</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="block w-full"
        style={{ aspectRatio: `${W} / ${H}`, maxHeight: H, width: "100%", height: "auto" }}
      >
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
      </svg>
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
