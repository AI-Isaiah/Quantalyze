import type { StrategyV2Detail } from "@/lib/queries";
import { PartialDataBanner } from "./PartialDataBanner";

interface OverviewPanelProps {
  panel1: StrategyV2Detail["panel1"];
  history_days: number;
}

const EM_DASH = "—";

function fmtList(values: string[] | null | undefined): string {
  if (!values || values.length === 0) return EM_DASH;
  return values.join(", ");
}

function fmtNumber(value: number | null): string {
  if (value === null || value === undefined) return EM_DASH;
  return value.toLocaleString();
}

function fmtString(value: string | null): string {
  if (!value) return EM_DASH;
  return value;
}

/**
 * Phase 14a / KPI-02 — Panel 1 Overview row.
 *
 * Server component. 6-cell horizontal grid (Supported exchanges / Types /
 * Subtypes / Markets / Leverage / Avg DTO) per UI-SPEC §4 + §7. Falls to
 * 3×2 below 980px. Empty cells render em-dash. When `history_days < 1`,
 * the body region is replaced by a partial-data banner per KPI-23a.
 */
export function OverviewPanel({ panel1, history_days }: OverviewPanelProps) {
  const showBanner = history_days < 1;

  return (
    <section
      data-panel="overview"
      aria-label="Overview"
      className="mt-8 rounded-lg border border-border bg-surface p-6 shadow-card"
    >
      <h2 className="text-base font-semibold text-text-primary">Overview</h2>

      {showBanner ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 1 day of trading history to populate Overview."
          />
        </div>
      ) : (
        <dl className="mt-4 grid grid-cols-6 gap-3 max-md:grid-cols-3">
          <div>
            <dt className="text-xs font-normal text-text-muted">Supported exchanges</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtList(panel1.supported_exchanges)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Types</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtList(panel1.strategy_types)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Subtypes</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtList(panel1.subtypes)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Markets</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtList(panel1.markets)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Leverage</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtString(panel1.leverage_range)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Avg DTO</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtNumber(panel1.avg_daily_turnover)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
