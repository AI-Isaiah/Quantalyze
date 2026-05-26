"use client";

import React, { type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { FactsheetPayload, RollWindowPick } from "@/lib/factsheet/types";
import { ROLL_WINDOW_6MO, ROLL_WINDOW_90D } from "@/lib/factsheet/rolling";
import { TrustTierLabel } from "@/components/strategy/TrustTierLabel";
import { FactsheetProvider, useActiveComparator, useComparator, useDisplay, usePayload, useToggles, useXRange } from "./factsheet-context";
import { ComparatorPicker } from "./ComparatorPicker";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { HistogramChart } from "./HistogramChart";
import { MetricsColumn } from "./MetricsColumn";
import { StyleDriftPanel, PeerPercentilePanel, AllocatorSection } from "./BatchDPanels";
import { StreakDistributionPanel } from "./AnalyticalPanels";
import { EndOfYearBarsPanel, QuantileBoxPlotPanel } from "./DistributionPanels";
import { MasterBrush } from "./MasterBrush";
import { StressWindowsPanel } from "./StressWindowsPanel";
import { CollapsibleSection, FACTSHEET_OPEN_ALL_EVENT } from "./CollapsibleSection";
import { LazyMount } from "./LazyMount";
// IMPORTANT-1/FINDING-8 (b06-codereview/silentfailure): Import the single-source
// formatters from format.ts so FactsheetView uses the same implementation that
// the audit tests cover. The private pct/pctSigned/num copies below were
// equivalent today but divergences would silently escape test coverage.
import { pct, pctSigned, ratio as num } from "./format";

/**
 * Code-split the three heaviest panels off the initial route bundle. These
 * components are below-the-fold and already wrapped in LazyMount, but
 * LazyMount only defers MOUNTING — the JS is still in the initial chunk.
 * next/dynamic creates a separate chunk that the client only fetches when
 * the component is about to render. Saves ~30-50KB gzip from first paint.
 *
 * ssr:false is safe because the entire factsheet view is "use client" —
 * server-render of these panels is already a no-op via the parent context.
 */
const MonthlyReturnsHeatmap = dynamic(
  () => import("./HeatmapPanels").then(m => ({ default: m.MonthlyReturnsHeatmap })),
  { ssr: false, loading: () => <PanelSkeleton h={400} /> },
);
const DailyReturnsHeatmap = dynamic(
  () => import("./HeatmapPanels").then(m => ({ default: m.DailyReturnsHeatmap })),
  { ssr: false, loading: () => <PanelSkeleton h={600} /> },
);
const SignaturesSection = dynamic(
  () => import("./SignaturePanels").then(m => ({ default: m.SignaturesSection })),
  { ssr: false, loading: () => <PanelSkeleton h={500} /> },
);
const CrossSignaturesSection = dynamic(
  () => import("./CrossSignaturePanels").then(m => ({ default: m.CrossSignaturesSection })),
  { ssr: false, loading: () => <PanelSkeleton h={500} /> },
);

function PanelSkeleton({ h }: { h: number }) {
  return (
    <div
      className="rounded-sm border border-border bg-surface-subtle animate-pulse"
      style={{ height: h }}
      aria-hidden
    />
  );
}
import { resolvePalette, paletteToCssVars } from "./palette";
import { trackFactsheetEvent } from "./factsheet-analytics";
import { CHART_CONFIGS } from "./chart-configs";

/**
 * Editorial layout — refined-minimalism inside the institutional/utilitarian
 * direction set by DESIGN.md. Instrument Serif for the strategy name + section
 * eyebrows, DM Sans for body and labels, Geist Mono tabular-nums for every
 * numeric. No decoration, no shadows, only hairline dividers carrying the
 * structure. Reference: FactSet quarterly factsheets.
 */
export function FactsheetView({ payload }: { payload: FactsheetPayload }) {
  return (
    <FactsheetProvider payload={payload}>
      <FactsheetShell payload={payload} />
    </FactsheetProvider>
  );
}

/**
 * Shell that reads the colorblind toggle from context and applies the FT
 * Oxford Blue / Claret palette overrides via CSS custom property scoping on
 * the article container. Lives inside the provider so it can subscribe.
 */
function FactsheetShell({ payload }: { payload: FactsheetPayload }) {
  const { colorblind, darkMode } = useDisplay();

  // One-shot view event when the page mounts so adoption of the new
  // surface can be measured cleanly without folding into the v1 funnel.
  React.useEffect(() => {
    trackFactsheetEvent("factsheet_v2_view", {
      strategy_id: payload.strategyId,
      trust_tier: payload.trustTier ?? "none",
      observations: payload.strategyMetrics.n,
    });
  }, [payload.strategyId, payload.trustTier, payload.strategyMetrics.n]);

  // Print hardening: collapsed <details> sections are hidden by default
  // browser behavior, so a print would lose any section the user closed.
  // beforeprint forces every detail open; afterprint restores prior state.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let previous: WeakMap<HTMLDetailsElement, boolean> | null = null;
    const beforeprint = () => {
      previous = new WeakMap();
      document.querySelectorAll<HTMLDetailsElement>("details").forEach(el => {
        previous!.set(el, el.open);
        el.open = true;
      });
    };
    const afterprint = () => {
      if (!previous) return;
      document.querySelectorAll<HTMLDetailsElement>("details").forEach(el => {
        const prior = previous!.get(el);
        if (prior != null) el.open = prior;
      });
      previous = null;
    };
    window.addEventListener("beforeprint", beforeprint);
    window.addEventListener("afterprint", afterprint);
    return () => {
      window.removeEventListener("beforeprint", beforeprint);
      window.removeEventListener("afterprint", afterprint);
    };
  }, []);
  return <FactsheetBody payload={payload} />;
}

export interface FactsheetBodyOptions {
  /** Suppress the strategy-name header (caller already provides its own). */
  hideHeader?: boolean;
  /** Suppress the demo allocator-portfolio section (skip on allocator dashboards). */
  hideAllocatorSection?: boolean;
  /** Suppress the QSF footer + disclaimer (caller already provides closing chrome). */
  hideFooter?: boolean;
  /** Render an optional slot above the KpiStrip — used to inject a live
   *  equity curve at the top of the allocator's Overview without
   *  reordering the rest of the factsheet body. */
  topSlot?: ReactNode;
}

/**
 * Full factsheet article body — strategy header + KpiStrip + SectionNav +
 * ControlBar + MasterBrush + all panel sections + MetricsColumn + (optional)
 * AllocatorSection + Footer. Pure JSX with the palette + skip-link wrapper.
 *
 * Must be mounted inside a FactsheetProvider. `factsheet-context.tsx`
 * exports both pieces.
 */
export function FactsheetBody({
  payload,
  hideHeader = false,
  hideAllocatorSection = false,
  hideFooter = false,
  topSlot,
}: { payload: FactsheetPayload } & FactsheetBodyOptions) {
  const { colorblind, darkMode } = useDisplay();
  // Centralised palette — resolve once, apply as CSS custom properties on
  // the article container so descendants pick up the new tokens via var().
  const resolved = resolvePalette({ darkMode, colorblind });
  const shellStyle = paletteToCssVars(resolved, darkMode);
  // 2026-05-20: gate event-study panels on having a comparator. The
  // Win/Loss-Event signature panels render "of —" with empty bands when
  // no benchmark is selected because they aggregate the BENCHMARK
  // trajectory around strategy events. Same for the cross-signatures
  // section (strategy events × benchmark). Without a comparator both
  // sections show 0 wins · 0 losses · blank bands, which reads as
  // broken; hide the entire Returns Signatures collapsible instead.
  const { key: cmpKey } = useActiveComparator();
  const hasComparator = cmpKey !== "none";
  return (
    <>
      <article
        id="factsheet-main"
        tabIndex={-1}
        data-theme={darkMode ? "dark" : "light"}
        data-colorblind={colorblind ? "1" : "0"}
        className="factsheet-v2-shell mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 py-6 sm:py-10 lg:py-12"
        style={{ background: "var(--color-page)", ...shellStyle }}
      >
        {!hideHeader && <FactsheetHeader payload={payload} />}
        {topSlot}
        <KpiStrip />
        <SectionNav />
        <ControlBar />

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-x-12 gap-y-10">
          <section className="flex flex-col gap-10 min-w-0">
            <MasterBrush />
            <CollapsibleSection
              id="factsheet-perf"
              title="Performance"
              storageKey={`factsheet-collapse:${payload.strategyId}:perf`}
              defaultOpen
            >
              <PerformanceCharts />
            </CollapsibleSection>
            <CollapsibleSection
              id="factsheet-dist"
              title="Distribution"
              storageKey={`factsheet-collapse:${payload.strategyId}:dist`}
              defaultOpen
            >
              <HistogramChart />
              <QuantileBoxPlotPanel />
              <EndOfYearBarsPanel />
            </CollapsibleSection>
            <CollapsibleSection
              id="factsheet-heatmaps"
              title="Heatmaps"
              storageKey={`factsheet-collapse:${payload.strategyId}:heatmaps`}
              defaultOpen
            >
              <MonthlyReturnsHeatmap />
              <DailyReturnsHeatmap />
            </CollapsibleSection>
            <CollapsibleSection
              id="factsheet-stress"
              title="Stress Windows"
              storageKey={`factsheet-collapse:${payload.strategyId}:stress`}
              defaultOpen
            >
              <StressWindowsPanel />
            </CollapsibleSection>
            {/* FINDING-2 (b06-silentfailure): Gate signatures on ingestSource === "api"
                in addition to hasComparator. Event signatures stitch the internal BTC
                fixture alongside the strategy returns; for CSV strategies with too few
                observations aggregate() fills empty trace populations with all-zero
                arrays — fabricating a flat zero band line indistinguishable from a
                real observation at 0% delta. Suppress for CSV to prevent false panels. */}
            {hasComparator && payload.ingestSource === "api" && (
              <CollapsibleSection
                id="factsheet-signatures"
                title="Returns Signatures"
                subtitle="event studies — heavy compute, defaults open"
                storageKey={`factsheet-collapse:${payload.strategyId}:signatures`}
                defaultOpen
              >
                <LazyMount minHeight={500}>
                  <SignaturesSection />
                </LazyMount>
                <LazyMount minHeight={500}>
                  <CrossSignaturesSection />
                </LazyMount>
              </CollapsibleSection>
            )}
            <CollapsibleSection
              id="factsheet-streak"
              title="Streaks"
              storageKey={`factsheet-collapse:${payload.strategyId}:streak`}
              defaultOpen
            >
              <StreakDistributionPanel />
            </CollapsibleSection>
          </section>
          <div id="factsheet-metrics" className="contents" />
          <MetricsColumn />
        </div>

        {/* AllocatorSection uses demo blended portfolios — derivable data only
            for api-ingested strategies. Suppress for CSV uploads per the
            no-invented-data contract. (NEW-C20-01) */}
        {!hideAllocatorSection && payload.ingestSource === "api" && (
          <div id="factsheet-allocator" className="mt-12">
            <LazyMount minHeight={400}>
              <AllocatorSection />
            </LazyMount>
          </div>
        )}

        {!hideFooter && <FactsheetFooter payload={payload} />}
      </article>
    </>
  );
}

/**
 * Performance charts — driven by CHART_CONFIGS, then specialized at runtime:
 *
 *   1. Comparator filter: two configs (`cumVsBench`, `rollingBeta`) have no
 *      strategy series of their own — only `strategy ÷ comparator` content.
 *      When no comparator is selected, rendering them gives an empty axis,
 *      so drop them from the list.
 *   2. Rolling-window relabel: when the data was too short for a 6mo window
 *      and we fell back to 30d, the rolling-{vol,sharpe,sortino} titles must
 *      reflect the real window. Also bump the warmup overlay's width to match
 *      so it doesn't paint a 126-day band over a 30-day series.
 */
const ROLLING_CHART_KEYS = new Set(["rollingVol", "rollingSharpe", "rollingSortino"]);

function PerformanceCharts() {
  const payload = usePayload();
  const { key: cmpKey } = useActiveComparator();
  // Defensive fallbacks: a cache entry created before the rollingWindow
  // fields were added would crash readers. The cache key was bumped in
  // the same commit so this should only hit during the 1h TTL drain; if
  // it ever fires steady-state, the warn below surfaces the schema drift.
  // Conservative fallback: `enough: false` so panels hide + "Not enough data"
  // shows when the window is unknown. The old `enough: true` default caused
  // rolling panels to render with a fabricated warmup label for any payload
  // that predated the rollingWindow field. (NEW-C20-03)
  const roll: RollWindowPick = payload.rollingWindow
    ?? { window: ROLL_WINDOW_6MO, label: "6mo", enough: false };
  const beta: RollWindowPick = payload.rollingBetaWindow
    ?? { window: ROLL_WINDOW_90D, label: "90d", enough: false };
  React.useEffect(() => {
    if (!payload.rollingWindow || !payload.rollingBetaWindow) {
      console.error(
        "[factsheet/v2] PerformanceCharts — payload missing rollingWindow/rollingBetaWindow; rendering with defaults. Bump factsheet-v2-payload cache key if this persists.",
        { strategyId: payload.strategyId },
      );
    }
  }, [payload.rollingWindow, payload.rollingBetaWindow, payload.strategyId]);

  const configs = React.useMemo(() => {
    return CHART_CONFIGS
      .filter(cfg => !(cmpKey === "none" && cfg.stratField === null && cfg.comparatorAsPrimary))
      // 2026-05-20: drop volMatched too when no comparator. Without one the
      // "Cumulative Returns — Volatility Matched" panel renders just the raw
      // strategy line (the comparator is what gets vol-scaled), which is
      // visually identical to the Equity Curve panel above it. Show it only
      // when there's an actual comparator to scale.
      .filter(cfg => !(cmpKey === "none" && cfg.key === "volMatched"))
      .filter(cfg => !(cfg.key === "rollingBeta" && !beta.enough))
      .filter(cfg => !(ROLLING_CHART_KEYS.has(cfg.key) && !roll.enough))
      .map(cfg => {
        if (ROLLING_CHART_KEYS.has(cfg.key)) {
          const title = cfg.title.replace(ROLL_LABEL_RE, `(${roll.label})`);
          return { ...cfg, title, warmup: roll.window };
        }
        if (cfg.key === "rollingBeta") {
          const title = cfg.title.replace(ROLL_LABEL_RE, `(${beta.label})`);
          return { ...cfg, title, warmup: beta.window };
        }
        return cfg;
      });
  }, [cmpKey, roll.enough, roll.label, roll.window, beta.enough, beta.label, beta.window]);

  return (
    <>
      {configs.map(cfg => (
        <TimeSeriesChart key={cfg.key} config={cfg} />
      ))}
      {!roll.enough && (
        <NotEnoughDataPanel
          title="Rolling Metrics — Not enough data"
          body="Strategy history is too short to compute even a 30-day rolling volatility / Sharpe / Sortino. Rolling charts will appear once the strategy has at least ~35 observations."
        />
      )}
      {!beta.enough && cmpKey !== "none" && (
        <NotEnoughDataPanel
          title="Rolling β — Not enough data"
          body="Strategy history is too short to compute even a 30-day rolling beta against the comparator. This panel will appear once the strategy has at least ~35 observations."
        />
      )}
    </>
  );
}

const ROLL_LABEL_RE = /\((6mo|30d|90d)\)/i;

function NotEnoughDataPanel({ title, body }: { title: string; body: string }) {
  return (
    <section className="border border-border bg-surface-subtle px-4 py-3">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-text-primary">
        {title}
      </h3>
      <p className="mt-1 text-[11px] text-text-muted">{body}</p>
    </section>
  );
}

function FactsheetHeader({ payload }: { payload: FactsheetPayload }) {
  const exchanges = payload.supportedExchanges.length > 0 ? payload.supportedExchanges.join(", ") : null;
  const leverage = payload.leverageRange;
  // Lead chip line — types / markets / subtypes / exchanges / leverage. Drop
  // empty members so the line stays tight when the registry row is sparse.
  const chips: string[] = [];
  if (payload.strategyTypes.length > 0) chips.push(payload.strategyTypes.join(", "));
  if (payload.subtypes.length > 0) chips.push(payload.subtypes.map(s => s.replace(/_/g, " ")).join(", "));
  if (payload.markets.length > 0) chips.push(payload.markets.join(" · "));
  if (exchanges) chips.push(exchanges);
  if (leverage) chips.push(`leverage ${leverage}`);

  // Only api_verified strategies have AUM/capacity/leverage/exchanges
  // confirmed by platform data. For csv_uploaded and self_reported tiers the
  // values are author-declared free-text — surface a "self-reported" qualifier
  // beside the chip line and the AUM/capacity chip so readers aren't misled
  // into treating them as verified facts. (NEW-C20-02)
  //
  // FINDING-3 (b06-silentfailure): trustTier=null means UNVERIFIED — the
  // strategy has never been through any verification step. "Self-reported" is
  // the specific trust-tier value "self_reported" or "csv_uploaded", meaning the
  // author explicitly declared the values. A null strategy gets no qualifier
  // (TrustTierLabel already handles the null case), not a false "self-reported".
  const isSelfReported =
    payload.trustTier === "csv_uploaded" || payload.trustTier === "self_reported";

  return (
    <header className="border-b border-text pb-6">
      <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-text-muted">
        Institutional Factsheet ·{" "}
        <span className="font-semibold text-accent">Quantalyze</span>
      </p>
      <div className="mt-2 flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="font-serif text-[28px] sm:text-[36px] lg:text-[44px] leading-tight sm:leading-none text-text-primary">
            {payload.strategyName}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
            <TrustTierLabel trustTier={payload.trustTier} />
            <span className="text-[12px] text-text-secondary">{chips.length > 0 ? chips.join(" · ") : "—"}</span>
            {isSelfReported && chips.length > 0 && (
              <span
                className="text-[10px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-sm"
                style={{
                  color: "var(--color-warning, #B45309)",
                  background: "color-mix(in srgb, var(--color-warning, #B45309) 12%, transparent)",
                }}
                title="These fields (exchanges, leverage, markets) are author-declared and have not been verified by Quantalyze"
              >
                self-reported
              </span>
            )}
          </div>
          {payload.description && (
            <p className="mt-3 sm:mt-4 text-[13px] sm:text-[14px] leading-relaxed text-text-2 italic font-serif">
              {payload.description}
            </p>
          )}
        </div>
        <div className="text-left sm:text-right flex flex-row sm:flex-col items-start sm:items-end gap-6 sm:gap-3 flex-wrap">
          <FreshnessChip computedAt={payload.computedAt} />
          {payload.aum != null && (
            <CapacityChip
              aum={payload.aum}
              maxCapacity={payload.maxCapacity}
              selfReported={isSelfReported}
            />
          )}
        </div>
      </div>
    </header>
  );
}

function formatUsdCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/**
 * Data freshness — institutional buyers reject stale reports.
 * Green ≤ 3d, amber 3-7d, red >7d. Date below.
 */
function FreshnessChip({ computedAt }: { computedAt: string }) {
  const d = new Date(computedAt);
  // useState initializer runs once per mount so render stays pure — Date.now()
  // would otherwise be flagged as impure-in-render. Hour resolution is fine
  // for the "fresh / stale / old" bucketing.
  const [nowMs] = React.useState(() => Date.now());
  const days = (nowMs - d.getTime()) / 86_400_000;
  // A future computedAt (days < 0) means the upstream series window is ahead
  // of now — treat as neutral/suspicious, never "fresh". (NEW-C20-07)
  const tone =
    !Number.isFinite(days) ? "neutral"
    : days < 0 ? "future"
    : days <= 3 ? "fresh"
    : days <= 7 ? "stale"
    : "old";
  const toneColor =
    tone === "fresh" ? "var(--color-positive)" :
    tone === "stale" ? "var(--color-warning, #B45309)" :
    tone === "old" ? "var(--color-negative)" : "var(--color-text-muted)";
  const label =
    tone === "fresh" ? "fresh"
    : tone === "stale" ? "stale"
    : tone === "old" ? "old"
    : tone === "future" ? "future — check data"
    : "—";
  return (
    <div>
      <div className="flex items-center justify-end gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted">
        <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: toneColor }} />
        Computed · {label}
      </div>
      <p className="mt-1 text-[13px] font-mono tabular-nums text-text-secondary">
        {formatIsoDate(computedAt)}
        {Number.isFinite(days) && days >= 0 && <span className="ml-1 text-text-muted">({Math.round(days)}d)</span>}
      </p>
    </div>
  );
}

/**
 * AUM + capacity utilization bar. Falls back to AUM-only when max_capacity
 * is not declared. Bar fills accent for healthy utilization, warning above 80%.
 * When selfReported=true (non-api_verified tier), labels the values as
 * author-declared to prevent them from reading as verified figures. (NEW-C20-02)
 */
function CapacityChip({
  aum,
  maxCapacity,
  selfReported = false,
}: {
  aum: number;
  maxCapacity: number | null;
  selfReported?: boolean;
}) {
  const utilization = maxCapacity && maxCapacity > 0 ? Math.min(1, aum / maxCapacity) : null;
  const tone =
    utilization == null ? "var(--color-accent)" :
    utilization > 0.9 ? "var(--color-negative)" :
    utilization > 0.7 ? "var(--color-warning, #B45309)" :
    "var(--color-accent)";
  return (
    <div className="min-w-[160px]">
      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted">
        AUM{selfReported && <span className="ml-1 normal-case" style={{ color: "var(--color-warning, #B45309)" }}>(self-reported)</span>}
      </p>
      <p className="mt-1 text-[13px] font-mono tabular-nums text-text-secondary">
        {formatUsdCompact(aum)}
        {maxCapacity != null && (
          <span className="ml-1 text-text-muted">/ {formatUsdCompact(maxCapacity)}</span>
        )}
      </p>
      {utilization != null && (
        <div className="mt-1.5 h-1 w-full bg-track rounded-sm overflow-hidden" aria-label={`Capacity utilization ${Math.round(utilization * 100)}%`}>
          <div
            className="h-full rounded-sm transition-all"
            style={{ width: `${utilization * 100}%`, background: tone }}
          />
        </div>
      )}
    </div>
  );
}

function KpiStrip() {
  const payload = usePayload();
  const { block: cmp, key: cmpKey } = useActiveComparator();
  const m = payload.strategyMetrics;
  const j = cmp.joint;
  const cn = cmp.shortName;

  // 9 cells when a comparator is active (mockup contract). When NONE, the
  // α + IR slots collapse — render 7 cells instead of leaving empty space.
  //
  // Tone is computed ONLY when the underlying value is finite — a NaN/Inf
  // metric formats to "—" but would otherwise render that dash with a red
  // "negative" tint, which conveys a false signal. Also: max_dd at exactly
  // 0 (no drawdown observed) gets no negative tint — a zero isn't bad. (NEW-C20-09)
  const signTone = (v: number | null | undefined): "positive" | "negative" | undefined =>
    v != null && Number.isFinite(v) ? (v >= 0 ? "positive" : "negative") : undefined;
  const maxDdTone = (v: number | null | undefined): "negative" | undefined =>
    v != null && Number.isFinite(v) && v < 0 ? "negative" : undefined;

  const items: Array<{ label: string; value: string; tone?: "positive" | "negative" }> = [
    { label: "Cum. Return", value: pctSigned(m.cum_ret, 1), tone: signTone(m.cum_ret) },
    { label: "CAGR", value: pctSigned(m.cagr, 1), tone: signTone(m.cagr) },
    { label: "Sharpe", value: num(m.sharpe) },
    { label: "Sortino", value: num(m.sortino) },
    { label: "Calmar", value: num(m.calmar) },
    { label: "Max DD", value: pct(m.max_dd, 1), tone: maxDdTone(m.max_dd) },
    { label: "Ann. Vol", value: pct(m.ann_vol, 1) },
  ];
  if (j && cmpKey !== "none") {
    items.push({
      label: `α vs ${cn}`,
      value: pctSigned(j.alpha, 1),
      tone: signTone(j.alpha),
    });
    items.push({
      label: `IR vs ${cn}`,
      value: num(j.info_ratio),
      tone: signTone(j.info_ratio),
    });
  }
  // Responsive grid: 9 cells need narrower cells on lg. Use grid-cols-9 only
  // when we actually have 9 to render; otherwise let 7 cells breathe at lg-7.
  // Mobile uses grid-cols-3 with smaller cells so 9 KPIs fit in 3 rows of 3.
  const lgCols = items.length === 9 ? "lg:grid-cols-9" : "lg:grid-cols-7";
  return (
    <section
      className="mt-6 overflow-hidden"
      style={{
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className={`grid grid-cols-3 sm:grid-cols-3 md:grid-cols-3 ${lgCols} md:divide-y-0`} style={{ }}>
        {items.map(it => (
          <div
            key={it.label}
            className="px-3 py-3 sm:px-4 sm:py-4"
            style={{ borderRight: "1px solid var(--color-border)", borderTop: "1px solid var(--color-border)" }}
          >
            <p
              className="text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.14em] sm:tracking-[0.18em] whitespace-nowrap overflow-hidden text-ellipsis"
              style={{ color: "var(--color-text-muted)" }}
            >
              {it.label}
            </p>
            <p
              className="mt-1.5 sm:mt-2 font-mono tabular-nums text-[15px] sm:text-[20px] lg:text-[22px] leading-none whitespace-nowrap overflow-hidden text-ellipsis"
              style={{
                color:
                  it.tone === "positive"
                    ? "var(--color-positive)"
                    : it.tone === "negative"
                      ? "var(--color-negative)"
                      : "var(--color-text-primary)",
              }}
            >
              {it.value}
            </p>
          </div>
        ))}
      </div>
      {/* Short-track caveat: annualized CAGR/Sharpe/Sortino/Calmar/Ann.Vol
          are statistically unreliable with fewer than 252 observations (~1y).
          Surface the same warning here at the hero strip so mobile users who
          never scroll to the MetricsColumn right-rail still see it. (NEW-C20-08) */}
      {m.n < 252 && (
        <p
          className="px-3 sm:px-4 py-2 text-[10px] font-mono"
          style={{
            borderTop: "1px solid var(--color-border)",
            color: "var(--color-warning, #B45309)",
          }}
        >
          ⚠ Only {m.n} observation{m.n !== 1 ? "s" : ""} — annualized metrics (CAGR, Sharpe, Sortino, Calmar, Ann. Vol) may not be statistically significant.
        </p>
      )}
    </section>
  );
}

/**
 * Section TOC — sticky compact nav with anchor links to each major section.
 * Tracks the currently visible section via IntersectionObserver and marks it
 * with aria-current="location" + an active visual style.
 *
 * Each link uses fragment-id anchor jump. Hidden on print and overflow-scrolls
 * on narrow widths.
 */
function SectionNav() {
  const payload = usePayload();
  const { key: cmpKey } = useActiveComparator();
  // FINDING-10 (b06-silentfailure): Filter out sections whose content is
  // conditionally suppressed so the nav doesn't contain dead anchors.
  // "Allocator" is only rendered when ingestSource === "api" (no-invented-data).
  // "Signatures" is only rendered when hasComparator AND ingestSource === "api".
  const hasComparator = cmpKey !== "none";
  const sections: { id: string; label: string }[] = React.useMemo(() => {
    const base: { id: string; label: string }[] = [
      { id: "factsheet-perf", label: "Performance" },
      { id: "factsheet-dist", label: "Distribution" },
      { id: "factsheet-heatmaps", label: "Heatmaps" },
      { id: "factsheet-stress", label: "Stress" },
      ...(hasComparator && payload.ingestSource === "api"
        ? [{ id: "factsheet-signatures", label: "Signatures" }]
        : []),
      { id: "factsheet-streak", label: "Streaks" },
      ...(payload.ingestSource === "api"
        ? [{ id: "factsheet-allocator", label: "Allocator" }]
        : []),
      { id: "factsheet-metrics", label: "Metrics" },
    ];
    return base;
  }, [payload.ingestSource, hasComparator]);
  const [active, setActive] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    // Pick the topmost intersecting section as active. rootMargin offset
    // accounts for the sticky nav so the section becomes "active" when its
    // top crosses just below the nav, not when it just barely enters view.
    const elements = sections
      .map(s => ({ id: s.id, el: document.getElementById(s.id) }))
      .filter((s): s is { id: string; el: HTMLElement } => s.el != null);
    if (elements.length === 0) return;
    const visibility = new Map<string, number>();
    const obs = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          visibility.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        }
        // Pick the entry with greatest intersection ratio.
        let bestId: string | null = null;
        let bestRatio = 0;
        visibility.forEach((r, id) => {
          if (r > bestRatio) { bestRatio = r; bestId = id; }
        });
        if (bestId) setActive(bestId);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: [0, 0.1, 0.5, 1] },
    );
    elements.forEach(({ el }) => obs.observe(el));
    return () => obs.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label="Factsheet sections"
      className="factsheet-v2-no-print mt-4 -mx-1 overflow-x-auto"
    >
      <ul className="flex items-center gap-1 px-1 text-[10px] font-mono uppercase tracking-[0.18em]">
        {sections.map(s => {
          const isActive = active === s.id;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={isActive ? "location" : undefined}
                className={
                  // pointer-coarse: bump tap target to 44px min-height per WCAG 2.5.5.
                  "inline-flex items-center px-2 py-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent pointer-coarse:min-h-[44px] pointer-coarse:px-3 " +
                  (isActive
                    ? "text-text-primary border-b-2 border-accent"
                    : "text-text-muted hover:bg-surface-subtle hover:text-text-primary")
                }
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * "Share mode" hides every outbound link in the factsheet so a recipient
 * landing on a shared URL can read the strategy but can't navigate further
 * into Quantalyze. Activated by the `?share=1` query param — set by the
 * Share-link button. Reads window.location directly (client-only) since
 * App Router pushes us toward useSearchParams which forces Suspense.
 */
function useShareMode(): boolean {
  const [shareMode, setShareMode] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    setShareMode(new URLSearchParams(window.location.search).get("share") === "1");
    const onPop = () =>
      setShareMode(new URLSearchParams(window.location.search).get("share") === "1");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return shareMode;
}

function ShareLinkButton({ strategyId }: { strategyId: string }) {
  const [copied, setCopied] = React.useState(false);
  const onClick = React.useCallback(() => {
    if (typeof window === "undefined") return;
    // Strip every query param except `share=1` so recipients don't inherit
    // the sender's transient camera/comparator state.
    const url = `${window.location.origin}${window.location.pathname}?share=1`;
    void navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // FINDING-9 (b06-silentfailure): Log so we can track clipboard
        // denial rates (common on non-HTTPS or when permission is denied).
        // Don't set copied=true so the button label stays "Copy share link"
        // and the user knows they need to copy manually.
        console.warn("[factsheet] clipboard.writeText denied", { strategyId });
      },
    );
    trackFactsheetEvent("factsheet_v2_share_copy", { strategy_id: strategyId });
  }, [strategyId]);
  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy a public, link-only factsheet URL — recipients see the same page with no outbound navigation"
      className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm border bg-surface-subtle text-text-2 border-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-[28px] pointer-coarse:min-h-[44px]"
    >
      {copied ? "Link copied" : "Copy share link"}
    </button>
  );
}

function ControlBar() {
  const payload = usePayload();
  const { resetXRange } = useXRange();
  const { setComparator } = useComparator();
  const shareMode = useShareMode();
  const resetView = () => {
    resetXRange();
    setComparator(payload.activeComparator);
    // "Reset view" means "show everything" — broadcast FACTSHEET_OPEN_ALL_EVENT
    // so every CollapsibleSection pops open. localStorage is left alone; the
    // next user toggle will rewrite it.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(FACTSHEET_OPEN_ALL_EVENT));
    }
    trackFactsheetEvent("factsheet_v2_reset_view", { strategy_id: payload.strategyId });
  };
  return (
    <section className="factsheet-v2-no-print mt-6 flex flex-wrap items-center justify-start lg:justify-end gap-x-3 sm:gap-x-6 gap-y-3 border-b border-border pb-3">
      <DisplayMenu />
      <button
        type="button"
        onClick={resetView}
        title="Reset comparator + visible window to defaults (toggles, persisted layout stay)"
        className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm border bg-surface-subtle text-text-2 border-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-[28px] pointer-coarse:min-h-[44px]"
      >
        Reset view
      </button>
      <ShareLinkButton strategyId={payload.strategyId} />
      {!shareMode && (
        <a
          href={`/compare?ids=${payload.strategyId}`}
          onClick={() => trackFactsheetEvent("factsheet_v2_compare_click", { strategy_id: payload.strategyId })}
          title="Compare this strategy against another (multi-strategy overlay)"
          className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm border bg-surface-subtle text-text-2 border-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-[28px] pointer-coarse:min-h-[44px] inline-flex items-center"
        >
          Compare strategies
        </a>
      )}
      <ComparatorPicker />
    </section>
  );
}

/**
 * Display-preferences disclosure — bundles Dark / Colorblind / Regimes
 * toggles behind a single dropdown so the ControlBar isn't a wall of pills
 * on mobile. Native <details> + <summary> for keyboard + screen-reader
 * accessibility and zero JS dependency.
 */
function DisplayMenu() {
  const { colorblind, setColorblind, regimes, setRegimes, darkMode, setDarkMode } = useToggles();
  const activeCount = (darkMode ? 1 : 0) + (colorblind ? 1 : 0) + (regimes ? 1 : 0);
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm border bg-surface-subtle text-text-2 border-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-[28px] pointer-coarse:min-h-[44px] inline-flex items-center gap-1">
        Display
        {activeCount > 0 && (
          <span
            className="inline-block px-1 rounded-sm text-[9px]"
            // Light: white on Oxford-green = 12:1. Dark: white on bright teal
            // = 1.5:1 (unreadable). Use page bg (dark slate) on teal in dark.
            style={{ background: "var(--color-accent)", color: "var(--color-page)" }}
          >
            {activeCount}
          </span>
        )}
      </summary>
      <div className="absolute right-0 lg:right-auto lg:left-0 top-full z-10 mt-1 min-w-[200px] bg-surface border border-border rounded-sm shadow-sm py-1">
        <DisplayItem
          label="Dark mode"
          on={darkMode}
          onToggle={() => {
            setDarkMode(!darkMode);
            trackFactsheetEvent("factsheet_v2_toggle_dark", { on: !darkMode });
          }}
          hint="Slate palette for low-light viewing"
        />
        <DisplayItem
          label="Colorblind palette"
          on={colorblind}
          onToggle={() => {
            setColorblind(!colorblind);
            trackFactsheetEvent("factsheet_v2_toggle_colorblind", { on: !colorblind });
          }}
          hint="FT Oxford Blue / Claret"
        />
        <DisplayItem
          label="Regimes overlay"
          on={regimes}
          onToggle={() => {
            setRegimes(!regimes);
            trackFactsheetEvent("factsheet_v2_toggle_regimes", { on: !regimes });
          }}
          hint="Bull/bear bands from comparator rolling Sharpe"
        />
      </div>
    </details>
  );
}

function DisplayItem({
  label,
  on,
  onToggle,
  hint,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className="w-full text-left px-3 py-2 pointer-coarse:py-3 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block w-3 h-3 rounded-sm border"
          style={{
            background: on ? "var(--color-accent)" : "transparent",
            borderColor: on ? "var(--color-accent)" : "var(--color-border)",
          }}
        />
        <span className="text-[12px] font-medium text-text-primary">{label}</span>
      </div>
      <p className="ml-5 mt-0.5 text-[10px] text-text-muted">{hint}</p>
    </button>
  );
}


function FactsheetFooter({ payload }: { payload: FactsheetPayload }) {
  const stamp = `QSF · ${payload.strategyId.slice(0, 8).toUpperCase()} · ${isoToYmd(payload.computedAt)}`;
  return (
    <footer className="mt-16 border-t border-text pt-6 flex flex-wrap items-start justify-between gap-6">
      <p className="max-w-3xl text-[11px] italic leading-relaxed text-text-muted">
        Returns computed from the strategy&apos;s daily series. Benchmarks are daily
        closes (forward-filled to the strategy&apos;s observation dates). Risk-free
        rate set to 0%. Past performance is not indicative of future results.
        Demo cohorts and demo portfolios are flagged inline; production replaces them
        with platform data.
      </p>
      <div className="text-right">
        <p className="font-mono text-[10px] tracking-[0.18em] text-text-primary">{stamp}</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Page 1 / 1
        </p>
      </div>
    </footer>
  );
}

// pct / pctSigned / num are imported from "./format" at the top of this file.
// (IMPORTANT-1/FINDING-8 — b06-codereview/silentfailure): removed private
// copies to ensure a single implementation is tested by audit-c20.test.ts.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function formatIsoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function isoToYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}
