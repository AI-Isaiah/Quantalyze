import type { StrategyV2Detail } from "@/lib/queries";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { OverviewPanel } from "./OverviewPanel";
import { HeadlineMetricsPanel } from "./HeadlineMetricsPanel";
import { DrawdownPanel } from "./DrawdownPanel";
import { ReturnsDistributionPanel } from "./ReturnsDistributionPanel";
import { RollingMetricsPanel } from "./RollingMetricsPanel";
import { TradeAndPositionPanel } from "./TradeAndPositionPanel";
import { ExposureAndGreeksPanel } from "./ExposureAndGreeksPanel";

interface StrategyV2ShellProps {
  detail: StrategyV2Detail;
}

/**
 * Phase 14a + 14b — Single-Strategy v2 page shell.
 *
 * Server component. Renders the full 7-panel scrollable layout:
 *   - Page header (H1 = strategy name in Instrument Serif 32px;
 *     start_date sub-line when present)
 *   - Panel 1 Overview (eager body)
 *   - Panel 2 Headline metrics + Equity vs BTC (eager body, client-interactive)
 *   - Panel 3 Drawdown analysis (eager body)
 *   - Panel 4 Returns distribution (lazy body — IntersectionObserver-mounted)
 *   - Panel 5 Rolling metrics (lazy body)
 *   - Panel 6 Trades & positions (eager-data, lazy-lifecycle wrapper)
 *   - Panel 7 Exposure & benchmark greeks (lazy body)
 *   - Strategy disclaimer footer
 *
 * Layout follows UI-SPEC §4: max-w-[1200px] container, px-6 py-12, panels
 * spaced via mt-8 (32px) on each section. The 7-panel hard count is asserted
 * by `tests/visual/strategy-v2-panel-count.test.tsx` (Plan 14a-05) AND
 * `src/components/strategy-v2/StrategyV2Shell.test.tsx` (Plan 14b-06).
 *
 * Wave-3 wiring: Plan 14b-06 replaced the four 14a placeholder slots with
 * the real Wave-2 panel bodies. The lazy components manage their own
 * IntersectionObserver lifecycle internally via `useLazyPanelMetrics`.
 */
export function StrategyV2Shell({ detail }: StrategyV2ShellProps) {
  const {
    strategy,
    panel1,
    panel2Headline,
    panel2Equity,
    panel3,
    panel4Inputs,
    panel5Inputs,
    panel6Inputs,
    panel7Inputs,
    history_days,
  } = detail;

  return (
    <main className="min-h-screen bg-page">
      <div className="mx-auto max-w-[1200px] px-6 py-12">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <h1
              className="text-text-primary"
              style={{
                fontFamily: "var(--font-serif), serif",
                fontSize: "32px",
                fontWeight: 400,
                lineHeight: 1.1,
              }}
            >
              {strategy.name}
            </h1>
            <VerifiedBadge />
          </div>
          {strategy.start_date ? (
            <p className="mt-2 text-xs font-normal text-text-muted">
              Live since {strategy.start_date}
            </p>
          ) : null}
        </header>

        <OverviewPanel panel1={panel1} history_days={history_days} />

        <HeadlineMetricsPanel
          strategyId={strategy.id}
          panel2Headline={panel2Headline}
          panel2Equity={panel2Equity}
          rolling_metrics={panel5Inputs.rolling_metrics}
          history_days={history_days}
        />

        <DrawdownPanel panel3={panel3} history_days={history_days} />

        {/*
          F2 follow-up (v0.17.1) — `key={strategy.id}` forces a full
          unmount + remount of each lazy panel on cross-strategy navigation.
          Without it, /strategy/abc/v2 → /strategy/xyz/v2 reuses the same
          React instances and the useLazyPanelMetrics hook keeps abc's
          resolved data alongside xyz's stale "loading" status (the hook's
          mountedRef + strategyId guards prevent the LEAK but cannot
          retrigger the fetch). The key isolates each panel's lifecycle
          to one strategy. Eager panels above (Overview / Headline /
          Drawdown) read from server-rendered props and don't carry
          per-strategy fetch state, so they are intentionally unkeyed.
         */}
        <ReturnsDistributionPanel
          key={strategy.id}
          strategyId={strategy.id}
          history_days={history_days}
          monthly_returns={panel4Inputs.monthly_returns}
          return_quantiles={panel4Inputs.return_quantiles}
          returns_series={panel4Inputs.returns_series}
          benchmark_returns={panel4Inputs.benchmark_returns}
        />

        <RollingMetricsPanel
          key={strategy.id}
          strategyId={strategy.id}
          history_days={history_days}
          rolling_metrics={panel5Inputs.rolling_metrics}
          sharpe={panel5Inputs.sharpe}
        />

        <TradeAndPositionPanel
          key={strategy.id}
          strategyId={strategy.id}
          trade_metrics={panel6Inputs.trade_metrics}
        />

        <ExposureAndGreeksPanel
          key={strategy.id}
          strategyId={strategy.id}
          history_days={history_days}
          benchmark_greeks={panel7Inputs.benchmark_greeks}
          correlation_analytics={panel7Inputs.correlation_analytics}
        />

        <div className="mt-8">
          <Disclaimer variant="strategy" />
        </div>
      </div>
    </main>
  );
}
