import type { StrategyV2Detail } from "@/lib/queries";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { OverviewPanel } from "./OverviewPanel";
import { HeadlineMetricsPanel } from "./HeadlineMetricsPanel";
import { DrawdownPanel } from "./DrawdownPanel";
import { LazyPanelPlaceholder } from "./LazyPanelPlaceholder";

interface StrategyV2ShellProps {
  detail: StrategyV2Detail;
}

/**
 * Phase 14a — Single-Strategy v2 page shell.
 *
 * Server component. Renders the full 7-panel scrollable layout:
 *   - Page header (H1 = strategy name in Instrument Serif 32px;
 *     start_date sub-line when present)
 *   - Panel 1 Overview (eager body)
 *   - Panel 2 Headline metrics + Equity vs BTC (eager body, client-interactive)
 *   - Panel 3 Drawdown analysis (eager body)
 *   - Panels 4–7 placeholder cards (IntersectionObserver-mounted)
 *   - Strategy disclaimer footer
 *
 * Layout follows UI-SPEC §4: max-w-[1200px] container, px-6 py-12, panels
 * spaced via mt-8 (32px) on each section. The 7-panel hard count is asserted
 * by `tests/visual/strategy-v2-panel-count.test.ts` (Plan 14a-05).
 */
export function StrategyV2Shell({ detail }: StrategyV2ShellProps) {
  const { strategy, panel1, panel2Headline, panel2Equity, panel3, history_days } = detail;

  return (
    <main className="min-h-screen bg-page">
      <div className="mx-auto max-w-[1200px] px-6 py-12">
        <header className="mb-8">
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
          {strategy.start_date ? (
            <p className="mt-2 text-xs font-normal text-text-muted">
              Live since {strategy.start_date}
            </p>
          ) : null}
        </header>

        <OverviewPanel panel1={panel1} history_days={history_days} />

        <HeadlineMetricsPanel
          panel2Headline={panel2Headline}
          panel2Equity={panel2Equity}
          history_days={history_days}
        />

        <DrawdownPanel panel3={panel3} history_days={history_days} />

        <LazyPanelPlaceholder
          panelId="panel4"
          dataPanelKey="returns-distribution"
          ariaLabel="Returns distribution"
          heading="Returns distribution"
        />
        <LazyPanelPlaceholder
          panelId="panel5"
          dataPanelKey="rolling"
          ariaLabel="Rolling metrics"
          heading="Rolling metrics"
        />
        <LazyPanelPlaceholder
          panelId="panel6"
          dataPanelKey="trades"
          ariaLabel="Trades & positions"
          heading="Trades & positions"
        />
        <LazyPanelPlaceholder
          panelId="panel7"
          dataPanelKey="exposure"
          ariaLabel="Exposure & benchmark greeks"
          heading="Exposure & benchmark greeks"
        />

        <div className="mt-8">
          <Disclaimer variant="strategy" />
        </div>
      </div>
    </main>
  );
}
