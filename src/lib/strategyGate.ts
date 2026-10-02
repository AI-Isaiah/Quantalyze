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
  | "SERIES_PROVENANCE_UNVERIFIED"
  // 161-07 / WIZERR-10 — a producer DID record how this series was built, and
  // what it recorded does not earn admission. Distinct from
  // SERIES_PROVENANCE_UNVERIFIED (which answers "nobody looked") and from
  // INSUFFICIENT_TRADES (which this case used to fall through to, and which
  // said "only 0 trade(s)" about a strategy with a full daily-return series and
  // no fills BY CONSTRUCTION).
  | "SERIES_EXAMINED_REFUSED"
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
 * - `composite_stitched` — the deterministic stitch of member series, stamped
 *                         by the composite producer after CONSULTING the member
 *                         verdicts. ⚠️ Read what that does and does not mean.
 *                         Until the 142.2 review this said the members "each
 *                         carried their own verdict", which was simply false:
 *                         the stitch job stamped a bare literal and never looked
 *                         at them. It looks now, but it inherits exactly ONE
 *                         property — a KNOWN gap. Any member stamped
 *                         `sampled_gapped` downgrades the composite to
 *                         `sampled_gapped`, which this list does not admit.
 *                         Member UNPROVEN-NESS is deliberately NOT inherited:
 *                         `fill_derived_unproven` is stamped for every ccxt
 *                         venue unconditionally, so propagating it would refuse
 *                         essentially every ccxt composite — and a composite has
 *                         zero trades by construction, so the daily branch is
 *                         its only route to publish. Proving a member's fills
 *                         fetch was whole is ingestion-side work, booked as
 *                         DEF-142.2-04.
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
 * 142.2 review FIX 1 — the verdicts a producer DID stamp after examining the
 * series, and which nevertheless do not earn admission.
 *
 * ⚠️ THIS SET DECIDES A MESSAGE, NEVER AN ADMISSION. Admission is
 * `SERIES_TRUSTED_FOR_DAILY_BRANCH` above and nothing else. This one answers a
 * third, narrower question — "did anybody actually look?" — whose only effect is
 * WHICH REFUSAL the user reads. Every value here refuses, every value not here
 * refuses; the two branches differ only in what they say and what remedy they
 * offer.
 *
 * WHY THE DISTINCTION IS WORTH A SET. Fail-closed correctly routes an
 * unexamined series to the trade branch — but the trade branch's sentence is
 * "Strategy has only 0 trade(s). A minimum of 5 trades is required." For a
 * ledger-backed strategy with 135 daily rows and zero fills BY CONSTRUCTION,
 * that is verbatim the false message this whole phase exists to delete, and the
 * migration is additive with NO BACKFILL — so EVERY pre-existing analytics row
 * reads NULL and lands there. Deploying the phase without this branch ships the
 * founder's own dogfood bug back to the screen.
 *
 * ⛔ THE FIX IS NOT A BACKFILL. Backfilling is forbidden by the migration's own
 * comment: it would fabricate a trust claim about series whose inputs no longer
 * exist to examine. The data is right; the DIAGNOSIS was wrong. A zero-trade
 * strategy with an unexamined series is not "a strategy with too few trades" —
 * it is a strategy whose provenance was never established, and the honest remedy
 * is a re-sync/re-derive that makes a producer look.
 *
 * DRIFT DIRECTION IS SAFE, and that is why a hand-typed set is acceptable here.
 * If a future producer mints a sixth verdict this file has not been taught, it
 * is absent from BOTH sets: absent from the allow-list, so it still refuses
 * (unchanged, fail-closed); absent from here, so it renders the
 * provenance-unverified copy and offers a re-sync. A slightly imprecise sentence
 * on a refusal — never an admission.
 *
 * ── 161-07 / WIZERR-10: A SET BECAME A MAP, AND THE VALUE IS THE SENTENCE ──
 *
 * Each verdict now carries its OWN reason, because 161-07 stopped routing this
 * arm to the trade floor and a refusal that says nothing specific is only half
 * an improvement. A Map rather than a Set + a parallel lookup ON PURPOSE: with
 * two structures, a sixth verdict added to one and forgotten in the other
 * refuses with `undefined` as its sentence. Here membership IS the sentence's
 * existence, so that state is unrepresentable.
 *
 * ⭐ BOTH SENTENCES WERE VALIDATED AGAINST THE PRODUCER before shipping, and
 * BOTH of 161-UI-SPEC's proposed clauses were CORRECTED rather than adopted.
 * The truth source is `analytics-service/services/broker_dailies.py`'s producer
 * registry docstring ("Who stamps what"), read first-hand:
 *
 *   · `sampled_gapped` — stamped by `combine_sfox_balance_history` when
 *     `nav_gap_days > 0`. That is ANY interior hole, not a big one. The UI-SPEC
 *     proposed "its sampling has gaps too large to verify", which asserts a
 *     magnitude test the producer does not perform and would be false of a
 *     one-day hole. The sentence below names the sampling and the holes and
 *     claims no threshold. (It also carries no COUNT: T-73-02 leak discipline
 *     keeps gap magnitude off this channel, and the producer's own comment says
 *     `nav_gap_days` "decides the branch, it never rides INTO the verdict".)
 *
 *   · `fill_derived_unproven` — stamped by `combine_realized_and_funding`
 *     (binance / bybit / okx) ALWAYS and UNCONDITIONALLY; the producer calls it
 *     "a CONSTANT, not a data-driven refinement". The UI-SPEC proposed "The
 *     return series was examined and refused: it is derived from fills that
 *     could not be proven complete", whose "examined and refused" implies a
 *     per-series finding. Nothing examined THIS series. What is true is a
 *     property of the METHOD: two independent streams are summed with no
 *     residual and no reconciliation, so nothing in the output distinguishes
 *     "no fills that day" from "the fills fetch silently truncated". The
 *     sentence below states the method's limit, not a verdict about the data.
 *
 * ⚠️ THESE STRINGS ARE OPERATOR-VISIBLE VERBATIM. `admin/strategy-review`
 * answers `Cannot approve: ${gate.reason}`, raw, with no copy hop — so each one
 * must read as a complete sentence after that prefix. The wizard's own copy is
 * a SEPARATE surface (`gateFailureToWizardError` → `WIZARD_ERROR_COPY`); these
 * are not user-facing wizard copy and must not be edited to sound like it.
 */
const SERIES_EXAMINED_BUT_REFUSED: ReadonlyMap<string, string> = new Map([
  [
    "fill_derived_unproven",
    "The return series is derived from individual fills, which cannot establish that the record is complete.",
  ],
  [
    "sampled_gapped",
    "The return series is built from sampled balance snapshots with interior gaps, so it is not a complete record.",
  ],
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
        // ── 161 REVIEW / WR-05: THE REASON MAY NOT NAME A CSV ────────────────
        //
        // ⚠️ OPERATOR-VISIBLE VERBATIM. `admin/strategy-review` answers
        // `Cannot approve: ${gate.reason}` with no copy hop, exactly as it does
        // for the two SERIES_EXAMINED_BUT_REFUSED sentences above.
        //
        // This sentence used to read "CSV history has only N day(s) of
        // returns." It named a source that MOST of the strategies reaching this
        // branch do not have. Reaching here requires `isDailyReturnsSourced`,
        // i.e. a verdict in `SERIES_TRUSTED_FOR_DAILY_BRANCH` — and only ONE of
        // its three members involves a CSV at all. Measured first-hand against
        // the producer registry in
        // `analytics-service/services/broker_dailies.py` ("Who stamps what"):
        //
        //   · `ledger_complete`     — `combine_native_ledger` (deribit, both
        //                             return paths), `combine_mt5_deal_ledger`
        //                             (mt5), and `combine_sfox_balance_history`
        //                             (sfox) when the observed NAV span has zero
        //                             interior holes. All KEYED accounts whose
        //                             dailies are folded from a venue ledger.
        //                             The user uploaded nothing.
        //   · `composite_stitched`  — `run_stitch_composite_job`. A stitch of
        //                             member series; the composite has no upload
        //                             of its own.
        //   · `user_supplied`       — the keyless-CSV path (`analytics_runner`).
        //                             The ONLY member for which "CSV" is true.
        //
        // So two of the three populations were being refused with a sentence
        // that quotes a day-count from a file they never sent. That is the same
        // false-sentence class 161-07 deleted from the wizard copy on this
        // identical evidence; this is the operator-facing surface it left
        // behind. "The return series" is the vocabulary the two
        // SERIES_EXAMINED_BUT_REFUSED sentences already use for the same
        // artefact, and it is true of all three producers.
        //
        // ⛔ THE CODE STILL SAYS CSV, ON PURPOSE. `INSUFFICIENT_CSV_HISTORY` is
        // a stable identifier consumed by `gateFailureToWizardError` and by the
        // wizard's `GATE_INSUFFICIENT_CSV_HISTORY` copy key; renaming it is a
        // cross-file change with no honesty gain, because the code never
        // reaches the operator's sentence (the admin route pins that it does
        // not). Only the SENTENCE was wrong, and only the sentence moved.
        reason: `The return series covers only ${csvRowCount} day(s). A minimum of ${STRATEGY_GATE_MIN_CSV_ROWS} days is required.`,
        detail: { rows: csvRowCount, min: STRATEGY_GATE_MIN_CSV_ROWS },
      };
    }
  } else {
    // 142.2 review FIX 1 — DIAGNOSE THE REFUSAL BEFORE COUNTING TRADES.
    //
    // Reaching here with `tradeCount === 0 && csvRowCount > 0` means: this
    // strategy HAS a daily-return series, and that series did not earn
    // admission. Falling straight through to the trade floor answers
    // "Strategy has only 0 trade(s). A minimum of 5 trades is required." about a
    // strategy that has 135 days of returns and no fills BY CONSTRUCTION —
    // which is both false and unwinnable, and is the exact sentence this phase
    // was opened to delete.
    //
    // Split by WHETHER A PRODUCER LOOKED, not by whether we like what it found:
    //   · nobody looked (NULL — every pre-existing row, since the migration is
    //     additive with no backfill — or a verdict this module has not been
    //     taught) → say THAT, and offer the remedy that makes a producer look.
    //   · a producer DID record how the series was built, and the record does
    //     not earn admission → say what the record says. 161-07 / WIZERR-10.
    //
    // ⚠️ THE SECOND ARM IS NEW AND THIS COMMENT'S PREVIOUS TEXT IS DELETED, not
    // amended. It said the examined case would "keep the existing trade-branch
    // routing. The D-15 acceptance test pins that case and it is unchanged
    // here." That fallthrough was deliberate at 142.2 and it is what produced
    // "Strategy has only 0 trade(s). A minimum of 5 trades is required." for a
    // gapped or fill-derived strategy with a full daily-return series and zero
    // fills BY CONSTRUCTION — false, unwinnable, and the same sentence the
    // NULL arm was written to stop showing. Only the diagnosis moved: D-15's
    // acceptance oracle still pins this input as REFUSED, and was re-cut in the
    // same commit to pin the code that now carries the refusal.
    //
    // ALL THREE ARMS REFUSE. This changes no admission decision anywhere; it
    // changes which true sentence the user reads. `?? ""` matches the coercion
    // on `isDailyReturnsSourced` — the empty string is in neither structure, so
    // an absent verdict lands on the honest "nobody looked" arm.
    //
    // MUTUAL EXCLUSIVITY is structural rather than incidental: the two arms
    // below test `has(v)` and `!has(v)` on the SAME map with the SAME coercion,
    // so exactly one is reachable for any input that gets this far, and neither
    // can fall through to the trade floor while `csvRowCount > 0`.
    if (
      input.tradeCount === 0 &&
      csvRowCount > 0 &&
      !SERIES_EXAMINED_BUT_REFUSED.has(input.seriesCompleteness ?? "")
    ) {
      return {
        passed: false,
        code: "SERIES_PROVENANCE_UNVERIFIED",
        reason:
          `Strategy has ${csvRowCount} day(s) of daily returns and no individual trades, ` +
          `but no record of how that series was built. We cannot verify a track record ` +
          `whose provenance was never established. Re-sync this strategy to re-derive it.`,
        detail: { rows: csvRowCount },
      };
    }

    // 161-07 / WIZERR-10 — the examined-but-refused arm, evaluated BEFORE the
    // trade floor because a strategy with a daily-return series is not a
    // strategy with too few trades.
    //
    // The per-verdict sentence is READ FROM THE MAP, never rebuilt here: the
    // membership test above and the lookup below are the one structure, so a
    // future sixth verdict cannot join the class without bringing a sentence
    // (see the map's docblock for how each was validated against its producer).
    if (input.tradeCount === 0 && csvRowCount > 0) {
      const examinedReason = SERIES_EXAMINED_BUT_REFUSED.get(
        input.seriesCompleteness ?? "",
      );
      if (examinedReason !== undefined) {
        return {
          passed: false,
          code: "SERIES_EXAMINED_REFUSED",
          reason: examinedReason,
          // ⚠️ ENUM-DERIVED SENTENCE + ROW COUNT ONLY. The verdict string itself
          // never rides on `detail` and neither does any gap magnitude
          // (T-73-02): `rows` is a count this module's own caller supplied,
          // matching the arm above.
          detail: { rows: csvRowCount },
        };
      }
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
