/**
 * Shared strategy review gate. Used by the admin approval route and
 * the wizard's SyncPreviewStep so both enforce the same thresholds
 * (>=5 trades, >=7 days, analytics complete, key or trades present).
 * Boundary case: EXACTLY 7.0 days passes (historic `< 7` semantics).
 */

export const STRATEGY_GATE_MIN_TRADES = 5;
export const STRATEGY_GATE_MIN_DAYS = 7;

export type GateFailureCode =
  | "NO_DATA_SOURCE"
  | "INSUFFICIENT_TRADES"
  | "INSUFFICIENT_DAYS"
  | "ANALYTICS_MISSING"
  | "ANALYTICS_PENDING"
  | "ANALYTICS_COMPUTING"
  | "ANALYTICS_FAILED";

export interface StrategyGateInput {
  /** Linked api_keys.id, or null if the strategy has no key connected. */
  apiKeyId: string | null;
  /** Total trades in the `trades` table for this strategy. */
  tradeCount: number;
  /** Timestamp of the earliest trade, or null when no trades exist. */
  earliestTradeAt: Date | null;
  /** Timestamp of the latest trade, or null when no trades exist. */
  latestTradeAt: Date | null;
  /** Current `strategy_analytics.computation_status`, or null if no row exists yet. */
  computationStatus:
    | "pending"
    | "computing"
    | "complete"
    | "failed"
    | null;
  /** Raw `strategy_analytics.computation_error` for richer messaging. */
  computationError: string | null;
}

export interface StrategyGateResult {
  /** True iff every threshold is satisfied. */
  passed: boolean;
  /** Stable code for i18n or scripted copy lookup. Null on success. */
  code: GateFailureCode | null;
  /** Human-readable one-sentence reason. Null on success. */
  reason: string | null;
  /**
   * Optional detail blob that the caller can pass to `formatKeyError` in
   * wizardErrors.ts. Example: `{ trades: 3, days: 4.2 }`.
   */
  detail: Record<string, number | string> | null;
}

const PASS: StrategyGateResult = {
  passed: true,
  code: null,
  reason: null,
  detail: null,
};

function computeSpanDays(earliest: Date | null, latest: Date | null): number | null {
  if (!earliest || !latest) return null;
  const ms = latest.getTime() - earliest.getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return ms / (1000 * 60 * 60 * 24);
}

export function checkStrategyGate(input: StrategyGateInput): StrategyGateResult {
  if (!input.apiKeyId && input.tradeCount === 0) {
    return {
      passed: false,
      code: "NO_DATA_SOURCE",
      reason:
        "Strategy has no API key connected and no trade data uploaded.",
      detail: null,
    };
  }

  if (input.tradeCount < STRATEGY_GATE_MIN_TRADES) {
    return {
      passed: false,
      code: "INSUFFICIENT_TRADES",
      reason: `Strategy has only ${input.tradeCount} trade(s). A minimum of ${STRATEGY_GATE_MIN_TRADES} trades is required.`,
      detail: { trades: input.tradeCount, min: STRATEGY_GATE_MIN_TRADES },
    };
  }

  const spanDays = computeSpanDays(input.earliestTradeAt, input.latestTradeAt);
  if (spanDays !== null && spanDays < STRATEGY_GATE_MIN_DAYS) {
    return {
      passed: false,
      code: "INSUFFICIENT_DAYS",
      reason: `Trades span only ${spanDays.toFixed(1)} day(s). A minimum of ${STRATEGY_GATE_MIN_DAYS} days of trading history is required.`,
      detail: { days: Number(spanDays.toFixed(2)), min: STRATEGY_GATE_MIN_DAYS },
    };
  }

  if (input.computationStatus === null) {
    return {
      passed: false,
      code: "ANALYTICS_MISSING",
      reason:
        "Analytics have not been computed for this strategy. Sync trades first.",
      detail: null,
    };
  }

  if (input.computationStatus === "pending") {
    return {
      passed: false,
      code: "ANALYTICS_PENDING",
      reason: "Analytics computation is queued and has not started yet.",
      detail: null,
    };
  }

  if (input.computationStatus === "computing") {
    return {
      passed: false,
      code: "ANALYTICS_COMPUTING",
      reason: "Analytics computation is still running.",
      detail: null,
    };
  }

  if (input.computationStatus === "failed") {
    return {
      passed: false,
      code: "ANALYTICS_FAILED",
      reason: `Analytics computation failed${input.computationError ? `: ${input.computationError}` : ""}.`,
      detail: input.computationError ? { error: input.computationError } : null,
    };
  }

  return PASS;
}
