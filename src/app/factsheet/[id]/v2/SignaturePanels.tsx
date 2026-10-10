"use client";

import { useMemo } from "react";
import { usePayload } from "./factsheet-context";
import { BaseLeverageNote } from "./basis-context";
import { benchmarkWithheldReason } from "@/lib/factsheet/returns-unit";
import type { EventSignature, EventSignaturesSet, FactsheetPayload } from "@/lib/factsheet/types";
import { niceStepValues } from "@/lib/chart-ticks";
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

/**
 * Phase 169.4 review round 2 CR-01: the benchmark of BOTH signature sections is
 * BTC by construction (`build-payload.ts` builds `eventSignatures` and
 * `benchEventSignatures` from `btcAligned` only), so every label says BTC,
 * whatever comparator the picker has active. Reading the active comparator's
 * name printed "of SPX" over BTC trajectories.
 */
export const SIG_BENCH = "BTC";

/**
 * The em-dash reason for a BTC view during a BTC outage. The predicate is the
 * one the allocator portfolios use (`build-payload.ts`, `btcUnavailable`), and the
 * wording is the allocator panel's, so one outage reads as one cause on the
 * page. An absent `benchmarkPrices` means "no coverage information" and is read
 * as unavailable, as the browser re-derive reads it (`types.ts`).
 */
export const BTC_OUTAGE_REASON = "BTC prices are unavailable right now";

export function btcPricesUnavailable(payload: FactsheetPayload): boolean {
  return payload.benchmarkPrices === undefined || "unavailable" in payload.benchmarkPrices;
}

const SIG_SUBTITLE_7D =
  "mean + median + 25/75 + 5/95 percentile bands of benchmark or accumulated-capital trajectory around strategy events · ±14d window";
const SIG_SUBTITLE_1D = "single-day win/loss events · same trajectory aggregations";

export function SignaturesSection() {
  const payload = usePayload();
  // B6 — eventSignatures lives only on the "api" arm; narrowing ingestSource
  // unlocks it (a csv read is a compile error). The parent gates this on
  // ingestSource === "api", so this is type-safety, not a runtime branch. (RED-TEAM-M3)
  if (payload.ingestSource !== "api") return null;
  // Phase 164.6.6.2 (D-10, UI-SPEC A16): the benchmark of these event studies is BTC by
  // construction (SIG_BENCH), so for a strategy whose returns are in a native unit every
  // panel is the empty form with the stated reason, whatever the comparator. No chart,
  // no count, and nothing to say about leverage because nothing is shown.
  if (payload.returnsUnit) {
    const reason = benchmarkWithheldReason(payload.returnsUnit, payload.convertedFrom);
    return (
      <section className="flex flex-col gap-10">
        <SignatureHorizon
          title="Returns Signatures for 7 Days Horizon"
          subtitle={SIG_SUBTITLE_7D}
          set={payload.eventSignatures?.h7 ?? null}
          btcUnavailable={false}
          withheldReason={reason}
        />
        <SignatureHorizon
          title="Returns Signatures for 1 Day Horizon"
          subtitle={SIG_SUBTITLE_1D}
          set={payload.eventSignatures?.h1 ?? null}
          btcUnavailable={false}
          withheldReason={reason}
        />
      </section>
    );
  }
  const sigs = payload.eventSignatures;
  if (!sigs) return null;
  return (
    <section className="flex flex-col gap-10">
      {/* H-1 (Phase 107 Fable red team): event-study signatures are server-side
          aggregations of per-event trajectories not carried in the payload, so their
          magnitudes cannot follow a client leverage what-if — they stay at base 1×. */}
      <BaseLeverageNote payload={payload} label="Event signatures shown at base 1× leverage" />
      {/* CR-01 (Phase 169.4): no count in the horizon title. The benchmark and
          equity views hold different populations once a benchmark null drops a
          benchmark trace, so each panel names its own N (see SignatureHorizon). */}
      <SignatureHorizon
        title="Returns Signatures for 7 Days Horizon"
        subtitle={SIG_SUBTITLE_7D}
        set={sigs.h7}
        btcUnavailable={btcPricesUnavailable(payload)}
      />
      <SignatureHorizon
        title="Returns Signatures for 1 Day Horizon"
        subtitle={SIG_SUBTITLE_1D}
        set={sigs.h1}
        btcUnavailable={btcPricesUnavailable(payload)}
      />
    </section>
  );
}

function SignatureHorizon({
  title,
  subtitle,
  set,
  btcUnavailable,
  withheldReason,
}: {
  title: string;
  subtitle: string;
  /** `null` only under `withheldReason`, where no population is read. */
  set: EventSignaturesSet | null;
  btcUnavailable: boolean;
  /** Phase 164.6.6.2 (A16): when set, every panel is the empty form with this reason. */
  withheldReason?: string;
}) {
  // Under a withheld reason nothing is read from the population: every slot gets a null
  // trace and the one reason, so no count and no chart can leak through.
  const sets = withheldReason === undefined ? set : null;
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
        <p className="text-micro text-text-muted">{subtitle}</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        <SignatureSlot
          title={`Win Event · of ${SIG_BENCH}`}
          sig={sets?.winOfBenchmark ?? null}
          n={sets?.benchWinCount ?? 0}
          emptyReason={withheldReason ?? (btcUnavailable ? BTC_OUTAGE_REASON : `no win event has a complete ±14-day window of ${SIG_BENCH} prices`)}
          tone="positive"
        />
        <SignatureSlot
          title={`Loss Event · of ${SIG_BENCH}`}
          sig={sets?.lossOfBenchmark ?? null}
          n={sets?.benchLossCount ?? 0}
          emptyReason={withheldReason ?? (btcUnavailable ? BTC_OUTAGE_REASON : `no loss event has a complete ±14-day window of ${SIG_BENCH} prices`)}
          tone="negative"
        />
        <SignatureSlot
          title="Win Event · of Accumulated Capital"
          sig={sets?.winOfEquity ?? null}
          n={sets?.winCount ?? 0}
          emptyReason={withheldReason ?? "no win event has a complete ±14-day window of returns"}
          tone="positive"
        />
        <SignatureSlot
          title="Loss Event · of Accumulated Capital"
          sig={sets?.lossOfEquity ?? null}
          n={sets?.lossCount ?? 0}
          emptyReason={withheldReason ?? "no loss event has a complete ±14-day window of returns"}
          tone="negative"
        />
      </div>
    </div>
  );
}

/**
 * CR-01 (Phase 169.4): one panel slot. A view with no trace is `null` and
 * renders the em-dash state (DESIGN.md null rule), never a flat 0% chart; a
 * populated view names its own event count in its title. The branch is here,
 * above SignaturePanel, because SignaturePanel calls hooks.
 */
function SignatureSlot({
  title,
  sig,
  n,
  emptyReason,
  tone,
}: {
  title: string;
  sig: EventSignature | null;
  n: number;
  emptyReason: string;
  tone: "positive" | "negative";
}) {
  if (sig === null) return <SignatureEmptyPanel title={title} reason={emptyReason} />;
  return <SignaturePanel title={`${title} · ${n} ${n === 1 ? "event" : "events"}`} sig={sig} tone={tone} />;
}

/**
 * The em-dash state for a signature view with no measurable trace (CR-01).
 * Shared with CrossSignaturePanels so both surfaces say the same thing.
 */
export function SignatureEmptyPanel({ title, reason }: { title: string; reason: string }) {
  return (
    <figure className="flex flex-col gap-2" data-signature-empty="">
      <header>
        <p className="text-caption font-semibold text-text-primary">{title}</p>
      </header>
      <div className="flex flex-col gap-1 py-6">
        <span className="font-metric text-text-muted" aria-hidden>
          —
        </span>
        <p className="text-micro text-text-muted">Not measurable: {reason}.</p>
      </div>
    </figure>
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
        <p className="text-caption font-semibold text-text-primary">{title}</p>
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
  return niceStepValues(lo, hi, count, 8, 0).map((v) => ({ value: v, label: formatPct(v) }));
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
        className="list-none cursor-pointer inline-flex items-center justify-center w-4 h-4 rounded-full border border-border text-micro text-text-muted hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        ?
      </summary>
      <div className="absolute z-10 left-0 top-full mt-1 max-w-xs p-3 text-micro leading-relaxed text-text-2 bg-surface border border-border rounded-sm shadow-sm">
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
