import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { apiKeyLabelById } from "@/lib/api-key-label";
import { holdingEquityContributionLocal } from "../../lib/live-holdings-summary";
import { CONNECTED_KEY_FALLBACK_NAME } from "../../lib/scenario-adapter";
import type { RiskWidgetData } from "./widget-data";

/**
 * Phase 169.4-01 (SC2): the ONE place the Allocations Risk tab maps the
 * allocator's book onto the risk widgets.
 *
 * Every risk widget reads `compositeReturns` first and falls back to
 * `buildCompositeReturns(strategies)`, the legacy portfolio-strategies set. On
 * a key-connected book that set is empty or zero-weighted, so VaR read
 * "Insufficient return data" while the Overview charted the book (169 RESEARCH
 * root cause G). This adapter sets `compositeReturns` to the book's own daily
 * returns (`equityDailyReturns`, the series the Overview's factsheet is built
 * from), as they come: no reweighting, no reordering.
 *
 * It also replaces `strategies` with the per-key set the Scenario runs over
 * (see `perKeyStrategies`), so risk decomposition and the correlation matrix
 * describe the same keys the Scenario does, and drops the precomputed
 * `analytics.correlation_matrix`, which was computed over the legacy set and
 * would otherwise win over the per-key computation in CorrelationMatrix.
 *
 * It returns the WHOLE payload and overrides only the fields it owns
 * (`compositeReturns`, `strategies`, `analytics.correlation_matrix`), so every
 * other field a widget reads (169.4-02's BTC series among them) passes through
 * unchanged. Call it only when `equityHistoryState` is "ready": while the
 * history is rebuilding `equityDailyReturns` is `[]` by contract, and the Risk
 * tab shows the rebuilding panel instead of any widget.
 */
export type BookRiskInput = Omit<
  MyAllocationDashboardPayload,
  "strategies" | "analytics"
> & {
  strategies: RiskWidgetData["strategies"];
  analytics: Omit<NonNullable<MyAllocationDashboardPayload["analytics"]>, "correlation_matrix"> | null;
  compositeReturns: MyAllocationDashboardPayload["equityDailyReturns"];
};

export function bookRiskInput(payload: MyAllocationDashboardPayload): BookRiskInput {
  return {
    ...payload,
    strategies: perKeyStrategies(payload),
    analytics: withoutPrecomputedCorrelation(payload.analytics),
    compositeReturns: payload.equityDailyReturns ?? [],
  };
}

/**
 * One widget `strategies` entry per connected key, built by the Scenario's
 * rules (ScenarioComposer `perKeyAdapterOutput` +
 * `buildPerKeyStrategyForBuilderSet`):
 * - only keys in `contributingApiKeyIds` (the Scenario drops manager-side keys
 *   that carry a series but have no toggle row);
 * - a key with an empty series is skipped;
 * - named by `apiKeyLabelById`, falling back to the Scenario's neutral
 *   `CONNECTED_KEY_FALLBACK_NAME`, never the raw id;
 * - weighted by the key's equity share, Σ `holdingEquityContributionLocal` over
 *   its holdings, clamped at 0: the Scenario's raw weight. RiskDecomposition
 *   renormalizes, and falls back to equal weights when every weight is 0 (a
 *   book with no reported holdings), so there is no second fallback here.
 */
function perKeyStrategies(
  payload: MyAllocationDashboardPayload,
): RiskWidgetData["strategies"] {
  const labels = apiKeyLabelById(payload.apiKeys ?? []);
  const equity = new Map<string, number>();
  for (const h of payload.holdingsSummary ?? []) {
    if (!h.api_key_id) continue;
    equity.set(
      h.api_key_id,
      (equity.get(h.api_key_id) ?? 0) + holdingEquityContributionLocal(h),
    );
  }
  const contributing = new Set(payload.contributingApiKeyIds ?? []);
  const out: RiskWidgetData["strategies"] = [];
  for (const [keyId, returns] of Object.entries(
    payload.perKeyReturnsByApiKeyId ?? {},
  )) {
    if (!contributing.has(keyId)) continue;
    if (!returns || returns.length === 0) continue;
    const name = labels.get(keyId) ?? CONNECTED_KEY_FALLBACK_NAME;
    out.push({
      strategy_id: keyId,
      alias: name,
      current_weight: Math.max(0, equity.get(keyId) ?? 0),
      strategy: {
        id: keyId,
        name,
        strategy_analytics: { daily_returns: returns },
      },
    });
  }
  return out;
}

function withoutPrecomputedCorrelation(
  analytics: MyAllocationDashboardPayload["analytics"],
): BookRiskInput["analytics"] {
  if (!analytics) return null;
  const { correlation_matrix: _legacySet, ...rest } = analytics;
  return rest;
}
