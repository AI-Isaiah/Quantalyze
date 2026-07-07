/**
 * Shared strategy review gate. Used by the admin approval route and
 * the wizard's SyncPreviewStep so both enforce the same thresholds
 * (>=5 trades, >=7 days, analytics complete, key or trades present).
 * Boundary case: EXACTLY 7.0 days passes (historic `< 7` semantics).
 */

export const STRATEGY_GATE_MIN_TRADES = 5;
export const STRATEGY_GATE_MIN_DAYS = 7;
// CSV-uploaded strategies have no `trades` rows; their history lives in
// `csv_daily_returns` (one row per day). Mirror the 7-day trade-history floor
// as a 7-row minimum so a too-short CSV still can't be listed publicly.
export const STRATEGY_GATE_MIN_CSV_ROWS = 7;

export type GateFailureCode =
  | "NO_DATA_SOURCE"
  | "INSUFFICIENT_TRADES"
  | "INSUFFICIENT_DAYS"
  | "INSUFFICIENT_CSV_HISTORY"
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
    | "complete_with_warnings"
    | "failed"
    | null;
  /** Raw `strategy_analytics.computation_error` for richer messaging. */
  computationError: string | null;
  /**
   * `csv_daily_returns` row count for CSV-uploaded strategies (one row per
   * day). 0 / undefined for exchange-key strategies, whose history lives in
   * `trades`. A CSV upload NEVER populates `trades`, so without this the
   * `!apiKeyId && tradeCount === 0` data-source check false-failed every
   * CSV strategy with NO_DATA_SOURCE and made CSV strategies un-approvable.
   */
  csvRowCount?: number;
  /**
   * True when the strategy's connected exchange is ledger-backed (Deribit):
   * returns are derived into `csv_daily_returns` from the txn-log ledger and
   * the `trades` table is NEVER populated (P72). This is what lets the gate
   * admit a KEYED daily-returns strategy — WITHOUT it, dropping the `!apiKeyId`
   * term would also admit a keyed FILL-based (perp) strategy that merely has 0
   * trades in-window but a funding-derived `csv_daily_returns` series (which,
   * unlike the Deribit ledger, has no fail-loud completeness gate). Compute via
   * `isLedgerBackedExchange(api_keys.exchange)`. Undefined/false for fill-based
   * exchanges and CSV uploads.
   */
  isLedgerBacked?: boolean;
}

/**
 * Ledger-backed exchanges derive their return series into `csv_daily_returns`
 * from a transaction-log ledger and never write the `trades` table. Mirrors the
 * analytics-service `is_ledger_backed = source == "deribit"`
 * (services/ingestion/long_fetch.py) — keep the two in lockstep. Deribit is the
 * only such venue today.
 */
export function isLedgerBackedExchange(
  exchange: string | null | undefined,
): boolean {
  return exchange === "deribit";
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
  const csvRowCount = input.csvRowCount ?? 0;

  // A strategy needs at least one data source: a connected API key, ingested
  // `trades`, OR an uploaded CSV daily-returns series. CSV uploads never write
  // to `trades` (their history is in `csv_daily_returns`), so the prior
  // `!apiKeyId && tradeCount === 0` check false-failed every CSV strategy.
  if (!input.apiKeyId && input.tradeCount === 0 && csvRowCount === 0) {
    return {
      passed: false,
      code: "NO_DATA_SOURCE",
      reason:
        "Strategy has no API key connected and no trade data uploaded.",
      detail: null,
    };
  }

  // Daily-returns-sourced strategy (no trades, but has daily-return rows): the
  // trade-count and trade-span thresholds don't apply — there are zero trades
  // by construction. This covers BOTH keyless CSV uploads AND keyed ledger-
  // backed exchanges (Deribit) whose returns are derived into `csv_daily_returns`
  // and never write the `trades` table (P72).
  //
  // The `!input.apiKeyId || input.isLedgerBacked` term is load-bearing: a keyed
  // FILL-based (perp) strategy ALSO writes `csv_daily_returns` (funding series
  // via derive_broker_dailies), so `tradeCount === 0 && csvRowCount > 0` is
  // reachable for a perp with an in-window fills gap. Admitting that perp here
  // would publish it on a funding-only series that — unlike the Deribit ledger —
  // has NO fail-loud completeness gate (understated track record). So a keyed
  // strategy takes this branch ONLY when it is ledger-backed; a keyed perp with
  // 0 trades stays on the trade branch → INSUFFICIENT_TRADES until fills land.
  // The NO_DATA_SOURCE guard above still keys off `!apiKeyId`, so a keyed
  // strategy always has a source. Gate on the daily-return row count, then fall
  // through to the shared analytics-completeness checks below.
  const isDailyReturnsSourced =
    input.tradeCount === 0 &&
    csvRowCount > 0 &&
    (!input.apiKeyId || input.isLedgerBacked === true);
  if (isDailyReturnsSourced) {
    if (csvRowCount < STRATEGY_GATE_MIN_CSV_ROWS) {
      return {
        passed: false,
        code: "INSUFFICIENT_CSV_HISTORY",
        reason: `CSV history has only ${csvRowCount} day(s) of returns. A minimum of ${STRATEGY_GATE_MIN_CSV_ROWS} days is required.`,
        detail: { rows: csvRowCount, min: STRATEGY_GATE_MIN_CSV_ROWS },
      };
    }
  } else {
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
