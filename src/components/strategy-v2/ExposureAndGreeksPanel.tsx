"use client";

import { useMemo } from "react";
import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics";
import { PartialDataBanner } from "./PartialDataBanner";
import { BenchmarkGreeksTable } from "./BenchmarkGreeksTable";
import { NetGrossExposureChart } from "@/components/charts/NetGrossExposureChart";
import { TurnoverChart } from "@/components/charts/TurnoverChart";
import {
  CorrelationWithBenchmark,
  resolveBenchmarkCorrelation,
} from "@/components/charts/CorrelationWithBenchmark";
import { parseReturnsUnit } from "@/lib/factsheet/returns-unit";
import type { AnalyticsDataQualityFlags } from "@/lib/types";
import { greeksReason } from "@/lib/benchmark-why";
import type { V2JointStatus } from "@/lib/factsheet/v2-joint";
import {
  exposureWhy,
  keepExposurePoints,
  keepTurnoverPoints,
  turnoverWhy,
} from "./panel7-series";

/**
 * Subset of the analytics blob CorrelationWithBenchmark consumes (per its
 * own `resolveBenchmarkCorrelation` helper, which only reads `returns_series`
 * and `metrics_json`). We type the panel input narrowly here and `as never`
 * the call-site cast (see CorrelationWithBenchmark's full Props expects the
 * complete StrategyAnalytics shape; the underlying logic only touches these
 * two keys). This avoids forking CorrelationWithBenchmark while keeping
 * downstream consumers' input minimal.
 */
interface CorrelationAnalyticsSubset {
  returns_series: { date: string; value: number }[] | null;
  metrics_json: Record<string, unknown> | null;
}

interface BenchmarkGreeks {
  alpha: number | null;
  beta: number | null;
  /** Phase 170.5 (D-07): the fifth cell. Optional so a caller without it keeps compiling. */
  correlation?: number | null;
  ir: number | null;
  treynor: number | null;
}

interface ExposureAndGreeksPanelProps {
  strategyId: string;
  history_days: number;
  benchmark_greeks: BenchmarkGreeks;
  correlation_analytics: CorrelationAnalyticsSubset;
  /**
   * Phase 170.5 (D-03, D-04): the data-quality flags the say-why ladders read
   * (`csv_source`). Optional so callers that have none keep compiling.
   */
  data_quality_flags?: AnalyticsDataQualityFlags | null;
  /**
   * Phase 170.5 (D-07): why the five greeks are what they are. `error` and an
   * unresolved `needs_builder` render the retry banner instead of the strip.
   */
  benchmark_joint?: V2JointStatus;
}

/**
 * The lazy payload is untrusted JSONB, so both series are typed `unknown` and
 * `panel7-series.ts` owns the shape (a stored turnover row is
 * `{date, turnover}`, not the `{date, value}` the chart plots).
 */
interface Panel7LazyPayload {
  exposure_series?: unknown;
  turnover_series?: unknown;
}

/**
 * Panel 7 Exposure & benchmark greeks.
 *
 * Lazy-fetches `panel7` → `exposure` (migration 087 sibling-table contract;
 * line 174 maps to ARRAY['exposure_series', 'turnover_series']) on first
 * viewport intersection. The first two sub-sections mount when status==='ready'
 * and history_days >= 30; Correlation with BTC and Benchmark greeks mount
 * regardless of both, because they read eager props and not the lazy RPC (a lazy
 * failure only replaces the first two with the retry banner):
 *
 *   1. Net & gross exposure — NetGrossExposureChart (lazy `exposure_series`)
 *   2. Turnover            — TurnoverChart (lazy `turnover_series`)
 *   3. Correlation with BTC — CorrelationWithBenchmark (eager analytics
 *      subset; existing 90d rolling-window component reused as-is)
 *   4. Benchmark greeks    — BenchmarkGreeksTable: the factsheet's own five
 *      figures (D-07: alpha, beta, correlation, IR, Treynor from its live
 *      TypeScript joint, never the stored Python values), one reason line when
 *      a cell is a dash, and the retry banner when the source failed
 *
 * Partial-data thresholds:
 *   - Panel-level: history_days < 30 → PartialDataBanner replaces the exposure
 *     and turnover sub-sections only. Benchmark greeks are NOT gated on it: the
 *     factsheet's joint floors at MIN_PAIRED_OBSERVATIONS paired days and
 *     `benchmark_joint` carries that verdict, so 10-29 days still show the
 *     figures. Correlation is not gated on it either: its resolver takes
 *     `history_days` and names a short history in its own reason line.
 *   - Sub Net&Gross: `keepExposurePoints` keeps points with a string date and a
 *     finite gross and net. 2 or more draw, always, whatever the source flags,
 *     followed by a dated "through {date}" caption. Fewer says why by cause
 *     (`exposureWhy`): too few valid points, a CSV upload with no position-level
 *     series, or no stored series.
 *   - Sub Turnover:  `keepTurnoverPoints` keeps `{date, value}` points only. 2
 *     or more draw; otherwise `turnoverWhy` names one cause. Legacy
 *     `{date, turnover}` rows are price-scaled and are never charted or mapped
 *     to `value`.
 *   - Sub Correlation: the panel resolves the series itself
 *     (`resolveBenchmarkCorrelation` with a context). Only a resolved `ok`
 *     series with 2 or more points mounts CorrelationWithBenchmark; every other
 *     outcome renders the cause in a 240px 12px-caption block.
 */
export function ExposureAndGreeksPanel({
  strategyId,
  history_days,
  benchmark_greeks,
  correlation_analytics,
  data_quality_flags,
  benchmark_joint,
}: ExposureAndGreeksPanelProps) {
  const { ref, data, status } = useLazyPanelMetrics<Panel7LazyPayload>("panel7", {
    fetchOnIntersect: true,
    strategyId,
  });

  const panelLevelGated = history_days < 30;

  // Resolved here, not inside CorrelationWithBenchmark, so the v2 reason renders in
  // the 12px caption token: the shared component's non-ok body is 14px and
  // centred, which the v2 type contract forbids. v1 keeps the component as is.
  const nativeUnit = parseReturnsUnit(data_quality_flags?.native_unit);
  const benchmarkUnavailable = data_quality_flags?.benchmark_unavailable === true;
  const correlation = useMemo(
    () =>
      resolveBenchmarkCorrelation({
        ...correlation_analytics,
        context: { historyDays: history_days, nativeUnit, benchmarkUnavailable },
      }),
    [correlation_analytics, history_days, nativeUnit, benchmarkUnavailable],
  );

  const exposurePoints = keepExposurePoints(data?.exposure_series);
  const turnoverPoints = keepTurnoverPoints(data?.turnover_series);
  const exposureLastDate = exposurePoints.reduce(
    (latest, p) => (p.date > latest ? p.date : latest),
    "",
  );

  // Phase 170.5 WR-01/WR-02: the five greeks are eager server scalars (the
  // factsheet's joint), so they depend on `benchmark_greeks` and `benchmark_joint`
  // alone. Neither the 30-day exposure gate (the joint floors at 10 paired days)
  // nor the lazy panel7 status may hide them; it is rendered outside both.
  const greeksSubSection = (
    <SubSection title="Benchmark greeks">
      {benchmark_joint?.kind === "error" || benchmark_joint?.kind === "needs_builder" ? (
        // Failure is not absence: a source that failed (or a builder answer
        // the page could not resolve) is a retryable error, never five
        // dashes reading "not computed".
        <PartialDataBanner
          heading="Couldn’t load this section"
          body="Refresh the page to retry. The other panels still work."
        />
      ) : (
        <BenchmarkGreeksTable
          alpha={benchmark_greeks.alpha}
          beta={benchmark_greeks.beta}
          correlation={benchmark_greeks.correlation ?? null}
          ir={benchmark_greeks.ir}
          treynor={benchmark_greeks.treynor}
          reason={greeksReason(benchmark_joint, benchmark_greeks)}
        />
      )}
    </SubSection>
  );

  // Phase 170.5 R2-03: the rolling BTC correlation is resolved from eager props
  // (`correlation_analytics`, `data_quality_flags`, `history_days`), so like the
  // greeks it depends on neither the 30-day exposure gate nor the lazy panel7
  // status. A short history says so through the resolver's own reason text.
  const correlationSubSection = (
    <SubSection
      title="Correlation with BTC"
      caption="90-day rolling window, paired with BTC. The full-record correlation is in Benchmark greeks."
    >
      {correlation.kind === "ok" ? (
        <CorrelationWithBenchmark analytics={correlation_analytics} />
      ) : (
        <div
          className="flex items-center"
          style={{ minHeight: 240 }}
          data-testid="correlation-why"
        >
          <p className="text-xs font-normal text-text-muted">
            {correlation.message}
          </p>
        </div>
      )}
    </SubSection>
  );

  return (
    <section
      ref={ref}
      id="panel-exposure"
      tabIndex={-1}
      data-panel="exposure"
      data-panel-status={status === "idle" ? "placeholder" : status}
      aria-label="Exposure & benchmark greeks"
      className="mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card"
    >
      <h2 className="text-base font-semibold text-text-primary">
        Exposure &amp; benchmark greeks
      </h2>

      <div className="mt-4 space-y-6">
        {panelLevelGated ? (
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 30 days of trading history to compute exposure and turnover."
          />
        ) : status === "idle" || status === "loading" ? (
          <div
            aria-live="polite"
            className="flex items-center justify-center text-xs font-normal text-text-muted"
            style={{ minHeight: 180 }}
          >
            {"Loading…"}
          </div>
        ) : status === "error" ? (
          <PartialDataBanner
            heading="Couldn’t load this section"
            body="Refresh the page to retry. The other panels still work."
          />
        ) : (
          <>
            <SubSection title="Net & gross exposure">
              {exposurePoints.length >= 2 ? (
                <>
                  <NetGrossExposureChart data={exposurePoints} />
                  <p className="mt-2 text-xs font-normal text-text-muted">
                    USD notional, from position snapshots through {exposureLastDate}.
                  </p>
                </>
              ) : (
                <SubBanner
                  body={exposureWhy({
                    exposure: data?.exposure_series,
                    turnover: data?.turnover_series,
                    flags: data_quality_flags,
                  })}
                />
              )}
            </SubSection>

            <SubSection title="Turnover">
              {turnoverPoints.length >= 2 ? (
                <TurnoverChart data={turnoverPoints} />
              ) : (
                <SubBanner
                  body={turnoverWhy({
                    exposure: data?.exposure_series,
                    turnover: data?.turnover_series,
                    flags: data_quality_flags,
                  })}
                />
              )}
            </SubSection>
          </>
        )}

        {correlationSubSection}

        {greeksSubSection}
      </div>
    </section>
  );
}

function SubSection({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3
        className={`${caption ? "mb-1" : "mb-4"} text-xs font-normal uppercase tracking-wider text-text-secondary`}
      >
        {title}
      </h3>
      {caption ? (
        <p className="mb-4 text-xs font-normal text-text-muted">{caption}</p>
      ) : null}
      {children}
    </div>
  );
}

function SubBanner({ body }: { body: string }) {
  return <p className="text-xs font-normal text-text-muted">{body}</p>;
}
