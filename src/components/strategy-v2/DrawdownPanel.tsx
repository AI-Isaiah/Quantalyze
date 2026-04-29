import type { StrategyV2Detail } from "@/lib/queries";
import type { StrategyAnalytics } from "@/lib/types";
import { DrawdownChart } from "@/components/charts/DrawdownChart";
import { WorstDrawdowns } from "@/components/charts/WorstDrawdowns";
import { PartialDataBanner } from "./PartialDataBanner";

interface DrawdownPanelProps {
  panel3: StrategyV2Detail["panel3"];
  history_days: number;
}

/**
 * Phase 14a / KPI-05 — Panel 3 Drawdown analysis.
 *
 * Server component. Full-width DrawdownChart (Recharts) + Worst-5
 * Drawdowns table per UI-SPEC §4. When `history_days < 30`, the chart
 * body is replaced by a partial-data banner. The Worst-5 table reuses
 * its existing empty-state copy ("No meaningful drawdowns…") rather
 * than gating on history_days — preserves the established v1 behavior.
 *
 * `WorstDrawdowns` expects a full `StrategyAnalytics` shape but only
 * reads `metrics_json.drawdown_episodes` and `drawdown_series`. We
 * synthesize a minimal analytics adapter from `panel3` to reuse the
 * existing component without forking it (CONTEXT.md §code_context:
 * "no v2 fork").
 */
export function DrawdownPanel({ panel3, history_days }: DrawdownPanelProps) {
  const showChartBanner = history_days < 30;

  // Adapter: WorstDrawdowns reads only metrics_json.drawdown_episodes +
  // drawdown_series. Synthesizing a minimal shape lets us reuse the
  // existing component verbatim.
  const worstDrawdownsAnalytics = {
    metrics_json: panel3.drawdown_episodes
      ? { drawdown_episodes: panel3.drawdown_episodes }
      : null,
    drawdown_series: panel3.drawdown_series,
  } as unknown as StrategyAnalytics;

  return (
    <section
      data-panel="drawdown"
      aria-label="Drawdown analysis"
      className="mt-8 rounded-lg border border-border bg-surface p-6 shadow-card"
    >
      <h2 className="text-base font-semibold text-text-primary">Drawdown</h2>

      <h3 className="mt-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
        Drawdown
      </h3>
      {showChartBanner || !panel3.drawdown_series ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 30 days of trading history to detect meaningful drawdowns."
          />
        </div>
      ) : (
        <div className="mt-4">
          <DrawdownChart data={panel3.drawdown_series} />
        </div>
      )}

      <hr className="my-4 border-t border-border" />

      <h3 className="text-xs font-normal uppercase tracking-wider text-text-secondary">
        Worst 5 Drawdowns
      </h3>
      <div className="mt-4">
        <WorstDrawdowns analytics={worstDrawdownsAnalytics} />
      </div>
    </section>
  );
}
