"use client";

import { useMemo } from "react";
import { usePayload, useActiveComparator } from "./factsheet-context";
import type { EventSignature, EventSignaturesSet } from "@/lib/factsheet/types";

/**
 * Cross Signatures — mean-trajectory overlays per horizon.
 *
 * Each panel shows two mean lines on the same axes:
 *   - Strategy-driven mean (accent): trajectory averaged across the strategy's
 *     own win/loss events.
 *   - Benchmark-driven mean (muted): trajectory averaged across the
 *     benchmark's win/loss events.
 *
 * Reading: when the two lines diverge sharply post-event, the strategy is
 * reacting differently than the benchmark would on its own win/loss days.
 * When they overlay tightly, the strategy is tracking the benchmark's
 * behaviour.
 */

const VB_W = 880;
const VB_H = 200;
const PAD = { top: 22, right: 30, bottom: 32, left: 56 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const PLOT_H = VB_H - PAD.top - PAD.bottom;
const WINDOW = 14;
const TRACE_LEN = WINDOW * 2 + 1;

export function CrossSignaturesSection() {
  const payload = usePayload();
  const { block: cmp } = useActiveComparator();
  return (
    <section className="flex flex-col gap-10">
      <CrossHorizon
        title="Returns Cross Signatures for 7 Days Horizon"
        subtitle={`mean trajectory comparison · ±14d window · each panel overlays strategy-indexed mean (accent) vs ${cmp.shortName}-indexed mean (muted)`}
        stratSet={payload.eventSignatures.h7}
        benchSet={payload.benchEventSignatures.h7}
        benchName={cmp.shortName}
      />
      <CrossHorizon
        title="Returns Cross Signatures for 1 Day Horizon"
        subtitle="same overlay applied to single-day win/loss events"
        stratSet={payload.eventSignatures.h1}
        benchSet={payload.benchEventSignatures.h1}
        benchName={cmp.shortName}
      />
    </section>
  );
}

function CrossHorizon({
  title,
  subtitle,
  stratSet,
  benchSet,
  benchName,
}: {
  title: string;
  subtitle: string;
  stratSet: EventSignaturesSet;
  benchSet: EventSignaturesSet;
  benchName: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">{title}</h3>
        <p className="text-[11px] text-text-muted">{subtitle}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-3 h-0.5" style={{ background: "var(--color-accent)" }} />
            <span className="text-text-2">
              strategy events ({stratSet.winCount}W · {stratSet.lossCount}L)
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-3 h-0.5" style={{ background: "var(--color-text-muted)" }} />
            <span className="text-text-2">
              {benchName} events ({benchSet.winCount}W · {benchSet.lossCount}L)
            </span>
          </span>
        </div>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        <CrossPanel
          title={`Win Event · of ${benchName}`}
          stratMean={stratSet.winOfBenchmark}
          benchMean={benchSet.winOfBenchmark}
          tone="positive"
        />
        <CrossPanel
          title={`Loss Event · of ${benchName}`}
          stratMean={stratSet.lossOfBenchmark}
          benchMean={benchSet.lossOfBenchmark}
          tone="negative"
        />
        <CrossPanel
          title="Win Event · of Accumulated Capital"
          stratMean={stratSet.winOfEquity}
          benchMean={benchSet.winOfEquity}
          tone="positive"
        />
        <CrossPanel
          title="Loss Event · of Accumulated Capital"
          stratMean={stratSet.lossOfEquity}
          benchMean={benchSet.lossOfEquity}
          tone="negative"
        />
      </div>
    </div>
  );
}

function CrossPanel({
  title,
  stratMean,
  benchMean,
  tone,
}: {
  title: string;
  stratMean: EventSignature;
  benchMean: EventSignature;
  tone: "positive" | "negative";
}) {
  // Y-domain spans both means so the comparison is legible. Always include 0.
  const yDomain = useMemo<[number, number]>(() => {
    let lo = 0;
    let hi = 0;
    for (const s of [stratMean.mean, benchMean.mean]) {
      for (const v of s) {
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (lo === hi) hi = lo + 0.005;
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }, [stratMean, benchMean]);

  const X = (i: number) => PAD.left + (i / (TRACE_LEN - 1)) * PLOT_W;
  const Y = (v: number) => PAD.top + (1 - (v - yDomain[0]) / (yDomain[1] - yDomain[0])) * PLOT_H;
  const eventX = X(WINDOW);
  const yTicks = useMemo(() => niceTicks(yDomain[0], yDomain[1], 4), [yDomain]);
  const stratColor = tone === "positive" ? "var(--color-positive)" : "var(--color-negative)";

  return (
    <figure className="flex flex-col gap-2">
      <header>
        <p className="text-[12px] font-semibold text-text-primary">{title}</p>
      </header>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={title}
        className="block w-full"
        style={{ aspectRatio: `${VB_W} / ${VB_H}`, maxHeight: VB_H, width: "100%", height: "auto" }}
      >
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
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Bench-driven mean (rendered first so strategy mean reads on top) */}
        <path
          d={linePath(benchMean.mean, X, Y)}
          fill="none"
          stroke="var(--color-text-muted)"
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        {/* Strategy-driven mean — bold accent */}
        <path
          d={linePath(stratMean.mean, X, Y)}
          fill="none"
          stroke={stratColor}
          strokeWidth={2.2}
          strokeLinejoin="round"
        />

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
          fontSize={10}
          fontFamily="var(--font-mono)"
          fill="var(--color-text-primary)"
        >
          EVENT
        </text>

        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={PAD.top + PLOT_H}
          y2={PAD.top + PLOT_H}
          stroke="var(--color-text)"
          strokeWidth={1}
        />
        {[
          { i: 0, label: "−14d" },
          { i: 7, label: "−7d" },
          { i: 14, label: "0d" },
          { i: 21, label: "+7d" },
          { i: 28, label: "+14d" },
        ].map(t => (
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
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {t.label}
            </text>
          </g>
        ))}
      </svg>
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

function formatPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const x = v * 100;
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}
