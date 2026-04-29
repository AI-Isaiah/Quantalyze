"use client";

import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics";
import { PartialDataBanner } from "./PartialDataBanner";
import { BenchmarkGreeksTable } from "./BenchmarkGreeksTable";
import { NetGrossExposureChart } from "@/components/charts/NetGrossExposureChart";
import { TurnoverChart } from "@/components/charts/TurnoverChart";
import { CorrelationWithBenchmark } from "@/components/charts/CorrelationWithBenchmark";

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
  ir: number | null;
  treynor: number | null;
}

interface ExposureAndGreeksPanelProps {
  strategyId: string;
  history_days: number;
  benchmark_greeks: BenchmarkGreeks;
  correlation_analytics: CorrelationAnalyticsSubset;
}

interface Panel7LazyPayload {
  exposure_series?: { date: string; gross: number; net: number }[];
  turnover_series?: { date: string; value: number }[];
}

/**
 * Phase 14b-05 / KPI-18+19+20+21+23b — Panel 7 Exposure & benchmark greeks.
 *
 * Lazy-fetches `panel7` → `exposure` (migration 087 sibling-table contract,
 * verified Grok B-03 — line 174 maps to ARRAY['exposure_series',
 * 'turnover_series']) on first viewport intersection. Mounts 4 stacked
 * sub-sections when status==='ready' and history_days >= 30:
 *
 *   1. Net & gross exposure — NetGrossExposureChart (lazy `exposure_series`)
 *   2. Turnover            — TurnoverChart (lazy `turnover_series`)
 *   3. Correlation with BTC — CorrelationWithBenchmark (eager analytics
 *      subset; existing 90d rolling-window component reused as-is)
 *   4. Benchmark greeks    — BenchmarkGreeksTable (eager scalars from
 *      `metrics_json`: alpha / beta / IR / Treynor)
 *
 * Partial-data thresholds (UI-SPEC §4.3):
 *   - Panel-level: history_days < 30 → PartialDataBanner replaces all 4 sub-sections
 *   - Sub Net&Gross: empty exposure_series → SubBanner only
 *   - Sub Turnover:  empty turnover_series → SubBanner only
 *   - Sub Correlation: <90 day banner is internal to CorrelationWithBenchmark
 *
 * NOT yet mounted in StrategyV2Shell — that wiring lands in 14b-06.
 */
export function ExposureAndGreeksPanel({
  strategyId,
  history_days,
  benchmark_greeks,
  correlation_analytics,
}: ExposureAndGreeksPanelProps) {
  const { ref, data, status } = useLazyPanelMetrics<Panel7LazyPayload>("panel7", {
    fetchOnIntersect: true,
    strategyId,
  });

  const panelLevelGated = history_days < 30;

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

      {panelLevelGated ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 30 days of trading history to compute exposure and benchmark greeks."
          />
        </div>
      ) : status === "idle" || status === "loading" ? (
        <div
          aria-live="polite"
          className="mt-4 flex items-center justify-center text-xs font-normal text-text-muted"
          style={{ minHeight: 180 }}
        >
          {"Loading…"}
        </div>
      ) : status === "error" ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Couldn’t load this section"
            body="Refresh the page to retry. The other panels still work."
          />
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          <SubSection title="Net & gross exposure">
            {data?.exposure_series && data.exposure_series.length > 0 ? (
              <NetGrossExposureChart data={data.exposure_series} />
            ) : (
              <SubBanner body="Net & gross exposure unavailable for this strategy." />
            )}
          </SubSection>

          <SubSection title="Turnover">
            {data?.turnover_series && data.turnover_series.length > 0 ? (
              <TurnoverChart data={data.turnover_series} />
            ) : (
              <SubBanner body="Turnover unavailable for this strategy." />
            )}
          </SubSection>

          <SubSection title="Correlation with BTC">
            <CorrelationWithBenchmark
              analytics={correlation_analytics}
            />
          </SubSection>

          <SubSection title="Benchmark greeks">
            <BenchmarkGreeksTable
              alpha={benchmark_greeks.alpha}
              beta={benchmark_greeks.beta}
              ir={benchmark_greeks.ir}
              treynor={benchmark_greeks.treynor}
            />
          </SubSection>
        </div>
      )}
    </section>
  );
}

function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
        {title}
      </h3>
      {children}
    </div>
  );
}

function SubBanner({ body }: { body: string }) {
  return <p className="text-xs font-normal text-text-muted">{body}</p>;
}
