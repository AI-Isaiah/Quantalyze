"use client";

import { useMemo } from "react";
import { usePayload, useActiveComparator } from "./factsheet-context";
import type { EventSignature, EventSignaturesSet } from "@/lib/factsheet/types";
import { ResponsiveChartFrame } from "@/components/ResponsiveChartFrame";
import { useBreakpoint } from "@/hooks/useBreakpoint";

/**
 * Returns Signatures — event-study panels.
 *
 * For each horizon (1-day and 7-day) we render four sub-panels:
 *   - Win Event · of Benchmark        (positive event sign, benchmark trajectory)
 *   - Loss Event · of Benchmark       (negative event sign, benchmark trajectory)
 *   - Win Event · of Accumulated Cap. (positive event sign, strategy equity trajectory)
 *   - Loss Event · of Accumulated Cap.
 *
 * Each panel overlays:
 *   - 5/95 percentile band (low-opacity fill)
 *   - 25/75 percentile band (mid-opacity fill)
 *   - Median (muted thin line)
 *   - Mean (accent thick line, win=positive teal / loss=negative red)
 *   - EVENT vertical reference at t=0
 *   - X-axis ticks at −14d / −7d / 0d / +7d / +14d
 *   - Y-axis ticks at 5 nice-rounded percentage levels
 *
 * The compute is server-side; here we only project to pixel space and draw.
 */

const VB_W = 880;
// Desktop viewBox height = today's literal (230). CHART-03 portrait: a taller
// mobile viewBox is selected per-render inside SignaturePanel so the desktop
// SSR render stays byte-identical.
const VB_H_DESKTOP = 230;
const VB_H_MOBILE = 300;
const PAD = { top: 20, right: 30, bottom: 32, left: 56 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const WINDOW = 14;
const TRACE_LEN = WINDOW * 2 + 1;

export function SignaturesSection() {
  const payload = usePayload();
  const { block: cmp } = useActiveComparator();
  // B6 — eventSignatures lives only on the "api" arm; narrowing ingestSource
  // unlocks it (a csv read is a compile error). The parent gates this on
  // ingestSource === "api", so this is type-safety, not a runtime branch. (RED-TEAM-M3)
  if (payload.ingestSource !== "api") return null;
  const sigs = payload.eventSignatures;
  if (!sigs) return null;
  return (
    <section className="flex flex-col gap-10">
      <SignatureHorizon
        title={`Returns Signatures for 7 Days Horizon (${sigs.h7.winCount} wins · ${sigs.h7.lossCount} losses)`}
        subtitle="mean + median + 25/75 + 5/95 percentile bands of benchmark or accumulated-capital trajectory around strategy events · ±14d window"
        set={sigs.h7}
        benchName={cmp.shortName}
      />
      <SignatureHorizon
        title={`Returns Signatures for 1 Day Horizon (${sigs.h1.winCount} wins · ${sigs.h1.lossCount} losses)`}
        subtitle="single-day win/loss events · same trajectory aggregations"
        set={sigs.h1}
        benchName={cmp.shortName}
      />
    </section>
  );
}

function SignatureHorizon({
  title,
  subtitle,
  set,
  benchName,
}: {
  title: string;
  subtitle: string;
  set: EventSignaturesSet;
  benchName: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">{title}</h3>
          <Explainer label="What is an event-study signature?">
            For each day classified as a win or loss event, we capture the trajectory of either
            the benchmark or the strategy&apos;s equity from −14d to +14d around the event. Aggregating
            across all events gives the typical path: the bold line is the mean; the wide band is
            the 5/95 percentile range; the inner band is 25/75. Use it to spot whether wins look
            different from losses (asymmetry), and whether the benchmark moves predictably around
            strategy signals.
          </Explainer>
        </div>
        <p className="text-[11px] text-text-muted">{subtitle}</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        <SignaturePanel
          title={`Win Event · of ${benchName}`}
          sig={set.winOfBenchmark}
          tone="positive"
        />
        <SignaturePanel
          title={`Loss Event · of ${benchName}`}
          sig={set.lossOfBenchmark}
          tone="negative"
        />
        <SignaturePanel
          title="Win Event · of Accumulated Capital"
          sig={set.winOfEquity}
          tone="positive"
        />
        <SignaturePanel
          title="Loss Event · of Accumulated Capital"
          sig={set.lossOfEquity}
          tone="negative"
        />
      </div>
    </div>
  );
}

function SignaturePanel({
  title,
  sig,
  tone,
}: {
  title: string;
  sig: EventSignature;
  tone: "positive" | "negative";
}) {
  const isMobile = useBreakpoint() === "mobile";
  // Desktop arms = today's literals (VB_H 230, fontSize 10, 5 nice Y-ticks,
  // full 5-point X-tick set). Mobile: taller viewBox + bigger fonts + fewer ticks.
  const VB_H = isMobile ? VB_H_MOBILE : VB_H_DESKTOP;
  const PLOT_H = VB_H - PAD.top - PAD.bottom;
  const yTickFont = isMobile ? 16 : 10;
  const xTickFont = isMobile ? 16 : 10;
  const eventFont = isMobile ? 16 : 10;
  const yTickCount = isMobile ? 4 : 5;

  // Y-domain: span ±max across all six series. Pad by 6%.
  const yDomain = useMemo<[number, number]>(() => {
    let lo = Infinity;
    let hi = -Infinity;
    const all = [sig.p05, sig.p95, sig.p25, sig.p75, sig.mean, sig.median];
    for (const series of all) {
      for (const v of series) {
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-0.01, 0.01];
    // Always include 0 so the EVENT anchor reads naturally.
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
    if (lo === hi) hi = lo + 0.005;
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }, [sig]);

  const X = (i: number) => PAD.left + (i / (TRACE_LEN - 1)) * PLOT_W;
  const Y = (v: number) => PAD.top + (1 - (v - yDomain[0]) / (yDomain[1] - yDomain[0])) * PLOT_H;
  const eventX = X(WINDOW);

  const yTicks = useMemo(() => niceTicks(yDomain[0], yDomain[1], yTickCount), [yDomain, yTickCount]);
  // Reduce the x-axis label density at mobile (keep −14d / 0d / +14d); desktop
  // keeps the full 5-point set.
  const xTicksAll = [
    { i: 0, label: "−14d" },
    { i: 7, label: "−7d" },
    { i: 14, label: "0d" },
    { i: 21, label: "+7d" },
    { i: 28, label: "+14d" },
  ];
  const xTicks = isMobile ? xTicksAll.filter(t => t.i % 14 === 0) : xTicksAll;
  const accent = tone === "positive" ? "var(--color-positive)" : "var(--color-negative)";

  return (
    <figure className="flex flex-col gap-2">
      <header>
        <p className="text-[12px] font-semibold text-text-primary">{title}</p>
      </header>
      <ResponsiveChartFrame
        width={VB_W}
        height={VB_H}
        role="img"
        aria-label={title}
      >
        {/* Y gridlines + labels */}
        {yTicks.map(t => (
          <g key={`y-${t.value}`}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={Y(t.value)}
              y2={Y(t.value)}
              stroke="var(--color-border)"
              strokeDasharray={t.value === 0 ? "4 2" : "2 3"}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={Y(t.value) + 3}
              textAnchor="end"
              fontSize={yTickFont}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* P5..P95 wide band */}
        <path d={areaPath(sig.p05, sig.p95, X, Y)} fill={accent} fillOpacity={0.08} />
        {/* P25..P75 narrower band */}
        <path d={areaPath(sig.p25, sig.p75, X, Y)} fill={accent} fillOpacity={0.2} />
        {/* Median line — muted */}
        <path
          d={linePath(sig.median, X, Y)}
          fill="none"
          stroke="var(--color-text-muted)"
          strokeWidth={1.2}
          strokeDasharray="3 3"
        />
        {/* Mean line — bold accent */}
        <path d={linePath(sig.mean, X, Y)} fill="none" stroke={accent} strokeWidth={2.2} strokeLinejoin="round" />

        {/* EVENT vertical anchor */}
        <line
          x1={eventX}
          x2={eventX}
          y1={PAD.top}
          y2={PAD.top + PLOT_H}
          stroke="var(--color-text)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.4}
        />
        <text
          x={eventX}
          y={PAD.top - 8}
          textAnchor="middle"
          fontSize={eventFont}
          fontFamily="var(--font-mono)"
          fill="var(--color-text-primary)"
        >
          EVENT
        </text>

        {/* X-axis baseline */}
        <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={PAD.top + PLOT_H} y2={PAD.top + PLOT_H} stroke="var(--color-text)" strokeWidth={1} />
        {/* X-axis ticks */}
        {xTicks.map(t => (
          <g key={t.label}>
            <line
              x1={X(t.i)}
              x2={X(t.i)}
              y1={PAD.top + PLOT_H}
              y2={PAD.top + PLOT_H + 4}
              stroke="var(--color-text-muted)"
              strokeWidth={1}
            />
            <text
              x={X(t.i)}
              y={PAD.top + PLOT_H + 16}
              textAnchor="middle"
              fontSize={xTickFont}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {t.label}
            </text>
          </g>
        ))}
      </ResponsiveChartFrame>
    </figure>
  );
}

function linePath(values: number[], X: (i: number) => number, Y: (v: number) => number): string {
  const parts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) continue;
    parts.push(`${i === 0 ? "M" : "L"} ${X(i).toFixed(1)} ${Y(values[i]).toFixed(1)}`);
  }
  return parts.join(" ");
}

/** Close-path between a lower and upper series — fills the band between them. */
function areaPath(lower: number[], upper: number[], X: (i: number) => number, Y: (v: number) => number): string {
  if (lower.length === 0 || upper.length !== lower.length) return "";
  const parts: string[] = [];
  // Walk upper forward
  for (let i = 0; i < upper.length; i++) {
    parts.push(`${i === 0 ? "M" : "L"} ${X(i).toFixed(1)} ${Y(upper[i]).toFixed(1)}`);
  }
  // Walk lower backward to close
  for (let i = lower.length - 1; i >= 0; i--) {
    parts.push(`L ${X(i).toFixed(1)} ${Y(lower[i]).toFixed(1)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

function niceTicks(lo: number, hi: number, count: number): { value: number; label: string }[] {
  if (!(hi > lo)) return [];
  const span = hi - lo;
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rough)) || 0));
  const norm = rough / mag;
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  const step = nice * mag;
  const start = Math.ceil(lo / step) * step;
  const out: { value: number; label: string }[] = [];
  for (let v = start; v <= hi + step * 0.001 && out.length < 8; v += step) {
    out.push({ value: v, label: formatPct(v) });
  }
  return out;
}

/**
 * Tiny "?" disclosure with a short explainer body — native <details> so
 * keyboard + screen-reader users get the same affordance as mouse users.
 */
function Explainer({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="inline-block relative">
      <summary
        aria-label={label}
        title={label}
        className="list-none cursor-pointer inline-flex items-center justify-center w-4 h-4 rounded-full border border-border text-[9px] text-text-muted hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        ?
      </summary>
      <div className="absolute z-10 left-0 top-full mt-1 max-w-xs p-3 text-[11px] leading-relaxed text-text-2 bg-surface border border-border rounded-sm shadow-sm">
        {children}
      </div>
    </details>
  );
}

function formatPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const x = v * 100;
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}
