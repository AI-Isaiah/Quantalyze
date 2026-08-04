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
   * The PERSISTED completeness verdict for this strategy's daily-return
   * series — `strategy_analytics.series_completeness`, verbatim, as the caller
   * read it.
   *
   * REQUIRED and NULLABLE, deliberately. Required so a caller that "forgot" to
   * read it is a compile error rather than a silent fail-open; nullable because
   * NULL is a real and common state (no producer has examined this series yet).
   *
   * THIS MODULE DOES NOT COMPUTE IT. The producers do, each at the moment they
   * write the series and can still see its inputs: the `broker_dailies`
   * combiners (keyed venues), the CSV analytics runner (keyless uploads), and
   * the composite stitch job. TypeScript only READS the verdict; it holds no
   * opinion about which venue deserves trust.
   *
   * NULL means never-examined, and never-examined MUST refuse (fail closed).
   */
  seriesCompleteness: string | null;
}

/**
 * The POSITIVE allow-list of completeness verdicts that admit a strategy to the
 * daily-returns branch. Positive by construction: a deny-list would admit every
 * value nobody thought of — including NULL, including a verdict a future
 * producer invents — and admission is the unsafe direction (it publishes).
 *
 * - `ledger_complete`   — the series was folded from a complete transaction
 *                         ledger; there is nothing else to fetch.
 * - `user_supplied`     — a keyless CSV upload: the series IS the submission.
 * - `composite_stitched` — stitched from constituent series that each carried
 *                         their own verdict.
 *
 * Everything else refuses: `fill_derived_unproven` (a realized-PnL fetch left a
 * gap, so the series may be funding-only and materially understated),
 * `sampled_gapped`, and anything unrecognised.
 */
const SERIES_TRUSTED_FOR_DAILY_BRANCH: ReadonlySet<string> = new Set([
  "ledger_complete",
  "user_supplied",
  "composite_stitched",
]);

/**
 * The daily-returns-branch predicate, exported so every caller invokes ONE
 * implementation. It previously existed as a hand-duplicated copy in the admin
 * approval route's TOCTOU re-check, kept in step by a comment that said the two
 * "must never diverge" — and they diverged anyway. A comment is not an
 * enforcement mechanism; a shared function is.
 *
 * NOTE THE `?? ""` COERCION, and that its direction is the safe one: a NULL or
 * absent verdict becomes the empty string, which is not a member of the
 * allow-list, so it lands on the trade branch and REFUSES. A coerced-null that
 * silently passed would be the fabrication class this gate exists to prevent;
 * here the coercion can only ever refuse.
 */
export function isDailyReturnsSourced(input: {
  tradeCount: number;
  csvRowCount: number;
  seriesCompleteness: string | null;
}): boolean {
  return (
    input.tradeCount === 0 &&
    input.csvRowCount > 0 &&
    SERIES_TRUSTED_FOR_DAILY_BRANCH.has(input.seriesCompleteness ?? "")
  );
}

/**
 * Thrown when `checkStrategyGate` is handed an input it cannot evaluate.
 *
 * WHY THIS IS A REFUSAL AND NOT A VERDICT (C-3). `StrategyGateInput` documents
 * `earliestTradeAt` as "Timestamp of the earliest trade, or null when no trades
 * exist" (and `latestTradeAt` identically). So on the TRADE-SOURCED branch —
 * where `tradeCount` has already cleared `STRATEGY_GATE_MIN_TRADES`, i.e. trades
 * demonstrably exist — an unreadable span is a CONTRADICTION, not an absence:
 * the only way to reach it is a caller whose `earliestTradeAt`/`latestTradeAt`
 * read failed (or returned corrupt, out-of-order timestamps). Returning any
 * verdict there means answering a question about a strategy whose history was
 * never measured, and the answer the old code gave was PASS — a 2-day track
 * record published as verified the moment a timestamp read failed.
 *
 * Every OTHER null combination keeps its meaning: `tradeCount === 0` with null
 * timestamps is the genuine absence the docstring describes, and the
 * daily-returns branch (CSV upload / ledger-backed venue) never consults the
 * trade span at all. Neither refuses.
 *
 * ⚠️ CONSEQUENCE: `checkStrategyGate` is now a PARTIAL function. It answers a
 * verdict for representable inputs and refuses for unrepresentable ones, so
 * EVERY caller needs a fail-loud arm. A caller that lets this escape uncaught
 * fails closed (no publish, no render) — which is the safe direction — but the
 * intended handling is an explicit catch that reports a service-side failure
 * about US rather than a gate verdict about the strategy.
 *
 * The message carries NO user data: only `tradeCount`, an integer this module's
 * own caller counted. Never a timestamp, an id, or a database error string.
 */
export class StrategyGateUnevaluableError extends Error {
  constructor(tradeCount: number) {
    super(
      `Strategy gate cannot evaluate this strategy: ${tradeCount} trade(s) reported, ` +
        `but the trade span is unreadable (earliest/latest trade timestamps missing or out of order). ` +
        `Trades exist, so the span was never measured rather than being absent.`,
    );
    this.name = "StrategyGateUnevaluableError";
  }
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
  // by construction.
  //
  // Admission is decided by the PERSISTED completeness verdict, never by which
  // venue the key points at. The question the branch actually needs answered is
  // "is this daily series complete?", and only the producer that wrote the
  // series can answer it — it is the only party that could still see the
  // inputs. Every venue folds a ledger into the same daily series; whether a
  // venue additionally fetches fills into `trades` is an adapter capability and
  // says nothing about completeness.
  //
  // WHY AN UNKNOWN VERDICT REFUSES. A keyed FILL-based (perp) strategy also
  // writes `csv_daily_returns` (a funding series via derive_broker_dailies), so
  // `tradeCount === 0 && csvRowCount > 0` is reachable for a perp whose
  // realized-PnL fetch left a gap. Admitting it would publish a materially
  // understated track record as verified. Its producer stamps
  // `fill_derived_unproven`, which is not in the allow-list; and a series no
  // producer has stamped at all reads NULL, which is also not in the allow-list
  // (see the `?? ""` note on isDailyReturnsSourced — the coercion's only
  // possible direction is refusal). Either way the strategy stays on the trade
  // branch → INSUFFICIENT_TRADES until it has a verdict that earns admission.
  //
  // The NO_DATA_SOURCE guard above still keys off `!apiKeyId`, so a keyed
  // strategy always has a source. Gate on the daily-return row count, then fall
  // through to the shared analytics-completeness checks below.
  const dailyReturnsSourced = isDailyReturnsSourced({
    tradeCount: input.tradeCount,
    csvRowCount,
    seriesCompleteness: input.seriesCompleteness,
  });
  if (dailyReturnsSourced) {
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
    // Trades cleared the count floor above, so `earliestTradeAt`/`latestTradeAt`
    // cannot legitimately be null here (see StrategyGateUnevaluableError, which
    // quotes the input type's own docstring for those two fields). Refuse rather
    // than fall through: the comparison below is a `<`, so a null span used to
    // skip the day gate ENTIRELY and return PASS.
    if (spanDays === null) {
      throw new StrategyGateUnevaluableError(input.tradeCount);
    }
    // 140.4-16 / WR-10 — the `spanDays !== null &&` conjunct is GONE, not
    // merely redundant. It is the EXACT token the refusal above was written
    // to remove: while it stood, a reader could conclude the throw was the
    // belt to its braces rather than its replacement, and could "restore"
    // the fail-open by deleting the throw. The narrowing also now comes
    // from the type system rather than from a runtime check nothing can
    // reach.
    if (spanDays < STRATEGY_GATE_MIN_DAYS) {
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
