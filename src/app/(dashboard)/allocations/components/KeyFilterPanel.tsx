"use client";

import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { useExcludedKeyIds } from "../hooks/useExcludedKeyIds";

/**
 * Per-API-key include/exclude toggle on the Overview tab.
 *
 * Each row corresponds to one connected api_key. Toggling a row "Off"
 * marks the key as excluded for this allocator on this device. Excluded
 * keys are filtered OUT of Overview aggregates downstream:
 *   - holdingsSummary (per-row api_key_id → trivial client filter)
 *   - any other dashboard projection that exposes api_key_id
 *
 * Important honest-UI gap:
 *   - equityDailyPoints is server-blended at write time
 *     (allocator_equity_snapshots stores the aggregate, not per-key
 *     contributions). So the equity curve + factsheet panels keep showing
 *     all-keys data until a server-side re-aggregation endpoint lands.
 *     A subtle banner at the top of the panel explains this so the
 *     filtered KPI/holdings numbers don't appear to disagree with the
 *     chart silently. Avoid "fail-loud" anti-pattern — show, don't hide.
 *
 * Display-only filter (NO ingestion changes). The api_keys row stays
 * active; analytics-service keeps fetching for it; the user can flip
 * the toggle back on at any time without re-syncing.
 */

export interface KeyFilterPanelProps {
  allocatorId: string;
  apiKeys: MyAllocationDashboardPayload["apiKeys"];
  /**
   * Optional holdings summary — when provided, the panel renders
   * "N included · $X aggregate" so the user gets immediate visible
   * feedback that the filter is doing something. Without this prop the
   * panel still works; it just doesn't surface the aggregate.
   */
  holdingsSummary?: MyAllocationDashboardPayload["holdingsSummary"];
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

export function KeyFilterPanel({
  allocatorId,
  apiKeys,
  holdingsSummary,
}: KeyFilterPanelProps) {
  const { excluded, toggle } = useExcludedKeyIds(allocatorId);

  if (apiKeys.length === 0) return null;

  const excludedCount = apiKeys.filter((k) => excluded.has(k.id)).length;
  const allExcluded = excludedCount === apiKeys.length;

  // Optional included-holdings rollup. Filters by api_key_id, sums value_usd.
  // For derivatives we sum |unrealized_pnl_usd| where present — value_usd
  // on a perp row is notional contract size, not equity contribution
  // (see queries.ts:1293-1296). Adding them produces a misleading total.
  const includedHoldings =
    holdingsSummary?.filter((h) => !excluded.has(h.api_key_id)) ?? null;
  const includedValue =
    includedHoldings?.reduce((acc, h) => {
      if (h.holding_type === "derivative") {
        return acc + (h.unrealized_pnl_usd ?? 0);
      }
      return acc + (h.value_usd ?? 0);
    }, 0) ?? null;

  return (
    <section
      aria-label="API key data sources"
      data-testid="overview-key-filter-panel"
      className="mt-4 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-text-muted">
          Data sources
        </h2>
        <div className="flex items-baseline gap-3 text-[11px] text-text-muted">
          {includedHoldings != null && includedValue != null && (
            <span
              data-testid="overview-key-filter-rollup"
              className="font-mono"
            >
              {includedHoldings.length} holdings ·{" "}
              <span className="text-text-primary">
                {formatUsd(includedValue)}
              </span>
            </span>
          )}
          {excludedCount > 0 && (
            <span
              data-testid="overview-key-filter-caveat"
              title="Equity curve, Sharpe, drawdown, TWR, and other performance metrics are server-aggregated and still reflect every connected key until a per-key re-aggregation lands."
            >
              {excludedCount} of {apiKeys.length} excluded · chart unchanged
            </span>
          )}
        </div>
      </header>
      <ul role="list" className="flex flex-wrap gap-2">
        {apiKeys.map((key) => {
          const isExcluded = excluded.has(key.id);
          const checkboxId = `key-filter-${key.id}`;
          return (
            <li key={key.id} className="min-w-0">
              <label
                htmlFor={checkboxId}
                data-key-id={key.id}
                data-included={!isExcluded}
                className={[
                  "inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                  isExcluded
                    ? "border-border bg-page text-text-muted line-through decoration-text-muted/60"
                    : "border-accent/40 bg-surface text-text-primary hover:border-accent",
                ].join(" ")}
              >
                <input
                  id={checkboxId}
                  type="checkbox"
                  // Checked === INCLUDED in the aggregate. We flip the
                  // semantic at the boundary so the UI mental model
                  // matches "tick to include" rather than "tick to
                  // exclude" (closer to a "Visible" filter in a chart).
                  checked={!isExcluded}
                  onChange={() => toggle(key.id)}
                  className="h-3 w-3 cursor-pointer accent-accent"
                  aria-label={`${isExcluded ? "Include" : "Exclude"} ${key.label || key.exchange} from Overview aggregates`}
                />
                <span className="font-medium uppercase tracking-wider">
                  {key.exchange}
                </span>
                {key.label && key.label !== key.exchange && (
                  <span className="font-normal text-text-secondary">
                    {key.label}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {allExcluded && (
        <p
          role="status"
          data-testid="overview-key-filter-all-excluded"
          className="mt-2 text-[11px] text-text-muted"
        >
          All keys excluded — holdings totals will be zero. Re-include at least
          one key to see data.
        </p>
      )}
    </section>
  );
}
