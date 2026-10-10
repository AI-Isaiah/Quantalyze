"use client";

import { useMemo } from "react";
import { usePayload } from "./factsheet-context";
import { BaseLeverageNote } from "./basis-context";
import { benchmarkWithheldReason } from "@/lib/factsheet/returns-unit";
import { SignatureEmptyPanel, SIG_BENCH, BTC_OUTAGE_REASON, btcPricesUnavailable } from "./SignaturePanels";
import type { EventSignature, EventSignaturesSet } from "@/lib/factsheet/types";
import { niceStepValues } from "@/lib/chart-ticks";
import { ResponsiveChartFrame } from "@/components/ResponsiveChartFrame";
import { useBreakpoint } from "@/hooks/useBreakpoint";

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
// Desktop viewBox height = today's literal (200). CHART-03 portrait: a taller
// mobile viewBox is selected per-render inside CrossPanel so the desktop SSR
// render stays byte-identical.
const VB_H_DESKTOP = 200;
const VB_H_MOBILE = 280;
const PAD = { top: 22, right: 30, bottom: 32, left: 56 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const WINDOW = 14;
const TRACE_LEN = WINDOW * 2 + 1;

const CROSS_SUBTITLE_7D = `mean trajectory comparison · ±14d window · each panel overlays strategy-indexed mean (accent) vs ${SIG_BENCH}-indexed mean (muted)`;
const CROSS_SUBTITLE_1D = "same overlay applied to single-day win/loss events";

export function CrossSignaturesSection() {
  const payload = usePayload();
  // Review round 2 CR-01: both sets are BTC (see SIG_BENCH), never the active comparator.
  const btcUnavailable = btcPricesUnavailable(payload);
  // B6 — eventSignatures / benchEventSignatures live only on the "api" arm;
  // narrowing ingestSource unlocks them (a csv read is a compile error). The
  // parent gates this on ingestSource === "api", so these are type-safety
  // checks, not runtime branches. (RED-TEAM-M3)
  if (payload.ingestSource !== "api") return null;
  // Phase 164.6.6.2 (D-10, UI-SPEC A16): half of every cross panel is the BTC event
  // study, so for a strategy whose returns are in a native unit every panel is the
  // empty form with the stated reason, whatever the comparator.
  if (payload.returnsUnit) {
    const reason = benchmarkWithheldReason(payload.returnsUnit, payload.convertedFrom);
    return (
      <section className="flex flex-col gap-10">
        <CrossHorizon
          title="Returns Cross Signatures for 7 Days Horizon"
          subtitle={CROSS_SUBTITLE_7D}
          stratSet={null}
          benchSet={null}
          btcUnavailable={false}
          withheldReason={reason}
        />
        <CrossHorizon
          title="Returns Cross Signatures for 1 Day Horizon"
          subtitle={CROSS_SUBTITLE_1D}
          stratSet={null}
          benchSet={null}
          btcUnavailable={false}
          withheldReason={reason}
        />
      </section>
    );
  }
  if (!payload.eventSignatures || !payload.benchEventSignatures) return null;
  return (
    <section className="flex flex-col gap-10">
      {/* H-1 (Phase 107 Fable red team): cross-signature trajectories are server-side
          event aggregations not carried in the payload, so they cannot follow a client
          leverage what-if — they stay at base 1×. */}
      <BaseLeverageNote payload={payload} label="Cross-signature trajectories shown at base 1× leverage" />
      <CrossHorizon
        title="Returns Cross Signatures for 7 Days Horizon"
        subtitle={CROSS_SUBTITLE_7D}
        stratSet={payload.eventSignatures.h7}
        benchSet={payload.benchEventSignatures.h7}
        btcUnavailable={btcUnavailable}
      />
      <CrossHorizon
        title="Returns Cross Signatures for 1 Day Horizon"
        subtitle={CROSS_SUBTITLE_1D}
        stratSet={payload.eventSignatures.h1}
        benchSet={payload.benchEventSignatures.h1}
        btcUnavailable={btcUnavailable}
      />
    </section>
  );
}

function CrossHorizon({
  title,
  subtitle,
  stratSet,
  benchSet,
  btcUnavailable,
  withheldReason,
}: {
  title: string;
  subtitle: string;
  /** `null` only under `withheldReason`, where no population is read. */
  stratSet: EventSignaturesSet | null;
  benchSet: EventSignaturesSet | null;
  btcUnavailable: boolean;
  /** Phase 164.6.6.2 (A16): when set, every panel is the empty form with this reason. */
  withheldReason?: string;
}) {
  // Under a withheld reason nothing is read from either population (see SignatureHorizon).
  const strat = withheldReason === undefined ? stratSet : null;
  const bench = withheldReason === undefined ? benchSet : null;
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">{title}</h3>
        <p className="text-micro text-text-muted">{subtitle}</p>
        {withheldReason === undefined && (
          <div className="mt-2 flex flex-wrap gap-3 text-micro">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block w-3 h-0.5" style={{ background: "var(--color-accent)" }} />
              {/* CR-01 (Phase 169.4): no count in the legend. Each view holds its
                  own population once a benchmark null drops a benchmark trace, so
                  one W · L pair per line describes no single panel; each panel
                  names its own N instead. */}
              <span className="text-text-2">strategy events</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block w-3 h-0.5" style={{ background: "var(--color-text-muted)" }} />
              <span className="text-text-2">{SIG_BENCH} events</span>
            </span>
          </div>
        )}
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        <CrossSlot
          title={`Win Event · of ${SIG_BENCH}`}
          stratMean={strat?.winOfBenchmark ?? null}
          stratN={strat?.benchWinCount ?? 0}
          benchMean={bench?.winOfBenchmark ?? null}
          benchN={bench?.benchWinCount ?? 0}
          btcUnavailable={btcUnavailable}
          withheldReason={withheldReason}
          view={`${SIG_BENCH} prices`}
          tone="positive"
        />
        <CrossSlot
          title={`Loss Event · of ${SIG_BENCH}`}
          stratMean={strat?.lossOfBenchmark ?? null}
          stratN={strat?.benchLossCount ?? 0}
          benchMean={bench?.lossOfBenchmark ?? null}
          benchN={bench?.benchLossCount ?? 0}
          btcUnavailable={btcUnavailable}
          withheldReason={withheldReason}
          view={`${SIG_BENCH} prices`}
          tone="negative"
        />
        <CrossSlot
          title="Win Event · of Accumulated Capital"
          stratMean={strat?.winOfEquity ?? null}
          stratN={strat?.winCount ?? 0}
          benchMean={bench?.winOfEquity ?? null}
          benchN={bench?.winCount ?? 0}
          btcUnavailable={btcUnavailable}
          withheldReason={withheldReason}
          view="returns"
          tone="positive"
        />
        <CrossSlot
          title="Loss Event · of Accumulated Capital"
          stratMean={strat?.lossOfEquity ?? null}
          stratN={strat?.lossCount ?? 0}
          benchMean={bench?.lossOfEquity ?? null}
          benchN={bench?.lossCount ?? 0}
          btcUnavailable={btcUnavailable}
          withheldReason={withheldReason}
          view="returns"
          tone="negative"
        />
      </div>
    </div>
  );
}

/**
 * CR-01 (Phase 169.4): one cross panel slot. The panel compares two mean lines,
 * so it needs both: when either population has no trace (`null`), the panel
 * renders the em-dash state naming the missing side, never a flat 0% line. A
 * populated panel names both of its own event counts. The branch is here, above
 * CrossPanel, because CrossPanel calls hooks.
 */
function CrossSlot({
  title,
  stratMean,
  stratN,
  benchMean,
  benchN,
  btcUnavailable,
  withheldReason,
  view,
  tone,
}: {
  title: string;
  stratMean: EventSignature | null;
  stratN: number;
  benchMean: EventSignature | null;
  benchN: number;
  btcUnavailable: boolean;
  withheldReason?: string;
  view: string;
  tone: "positive" | "negative";
}) {
  if (withheldReason !== undefined) return <SignatureEmptyPanel title={title} reason={withheldReason} />;
  if (stratMean === null || benchMean === null) {
    // Review round 2 CR-01: during a BTC outage every BTC event and every BTC
    // trace is gone, so the missing side is BTC's prices, not window completeness
    // (the allocator panel names the same cause in the same words).
    if (btcUnavailable && benchMean === null) {
      return <SignatureEmptyPanel title={title} reason={BTC_OUTAGE_REASON} />;
    }
    const who =
      stratMean === null && benchMean === null
        ? "no event"
        : stratMean === null
          ? "no strategy event"
          : `no ${SIG_BENCH} event`;
    return <SignatureEmptyPanel title={title} reason={`${who} has a complete ±14-day window of ${view}`} />;
  }
  return (
    <CrossPanel
      title={`${title} · ${stratN} strategy / ${benchN} ${SIG_BENCH} events`}
      stratMean={stratMean}
      benchMean={benchMean}
      tone={tone}
    />
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
  const isMobile = useBreakpoint() === "mobile";
  // Desktop arms = today's literals (VB_H 200, fontSize 10, 4 nice Y-ticks,
  // full 5-point X-tick set). Mobile: taller viewBox + bigger fonts + fewer ticks.
  const VB_H = isMobile ? VB_H_MOBILE : VB_H_DESKTOP;
  const PLOT_H = VB_H - PAD.top - PAD.bottom;
  const yTickFont = isMobile ? 16 : 10;
  const xTickFont = isMobile ? 16 : 10;
  const eventFont = isMobile ? 16 : 10;
  const yTickCount = isMobile ? 3 : 4;

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
  const yTicks = useMemo(() => niceTicks(yDomain[0], yDomain[1], yTickCount), [yDomain, yTickCount]);
  // Reduce x-axis label density at mobile (keep −14d / 0d / +14d); desktop keeps
  // the full 5-point set.
  const xTicksAll = [
    { i: 0, label: "−14d" },
    { i: 7, label: "−7d" },
    { i: 14, label: "0d" },
    { i: 21, label: "+7d" },
    { i: 28, label: "+14d" },
  ];
  const xTicks = isMobile ? xTicksAll.filter(t => t.i % 14 === 0) : xTicksAll;
  const stratColor = tone === "positive" ? "var(--color-positive)" : "var(--color-negative)";

  return (
    <figure className="flex flex-col gap-2">
      <header>
        <p className="text-caption font-semibold text-text-primary">{title}</p>
      </header>
      <ResponsiveChartFrame
        width={VB_W}
        height={VB_H}
        role="img"
        aria-label={title}
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
              fontSize={yTickFont}
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
          fontSize={eventFont}
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

function niceTicks(lo: number, hi: number, count: number): { value: number; label: string }[] {
  if (!(hi > lo)) return [];
  return niceStepValues(lo, hi, count, 8, 0).map((v) => ({ value: v, label: formatPct(v) }));
}

function formatPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const x = v * 100;
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}
