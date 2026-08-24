import { describe, it, expect } from "vitest";
import {
  checkStrategyGate,
  StrategyGateUnevaluableError,
  STRATEGY_GATE_MIN_TRADES,
  STRATEGY_GATE_MIN_DAYS,
  STRATEGY_GATE_MIN_CSV_ROWS,
  type StrategyGateInput,
} from "./strategyGate";

/**
 * Gate helper regression tests. This module is called from two places:
 *  - src/app/api/admin/strategy-review/route.ts (admin approval gate)
 *  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
 *
 * Each failure mode must be deterministic so that the wizard's scripted
 * error copy (src/lib/wizardErrors.ts) can look up a stable code.
 *
 * Boundary cases: EXACTLY 5 trades passes, EXACTLY 7.0 days passes.
 * These match the historic inline gate at strategy-review/route.ts:34,45.
 */

/**
 * ORACLE INDEPENDENCE. Every verdict string below is a HAND-TYPED literal.
 * Nothing is imported from `strategyGate.ts` — not the allow-list Set, not a
 * union type, not a helper. If the production allow-list is widened, these
 * tests must be edited by hand to follow it; a test that imported the Set would
 * widen silently along with the policy it is supposed to pin.
 *
 * The allow-list this suite pins, stated so the expectations are readable
 * without opening the module: { "ledger_complete", "user_supplied",
 * "composite_stitched" }. Everything else — including NULL — refuses.
 */
const BASE: StrategyGateInput = {
  apiKeyId: "ak-1",
  tradeCount: 10,
  earliestTradeAt: new Date("2026-04-01T00:00:00Z"),
  latestTradeAt: new Date("2026-04-10T00:00:00Z"),
  computationStatus: "complete",
  computationError: null,
  // Never examined. The trade-branch cases below do not depend on it, and the
  // honest default for a strategy nobody has stamped is absence.
  seriesCompleteness: null,
};

describe("checkStrategyGate", () => {
  it("passes when every threshold is satisfied", () => {
    expect(checkStrategyGate(BASE)).toEqual({
      passed: true,
      code: null,
      reason: null,
      detail: null,
    });
  });

  it("passes complete_with_warnings — a terminal success this deny-list must admit (mig 20260707120000)", () => {
    // The gate is a DENY-LIST: only null/pending/computing/failed are rejected;
    // both 'complete' and 'complete_with_warnings' fall through to PASS. This
    // pins that intent so a future refactor to an allow-list (=== 'complete')
    // can't silently make warned strategies un-approvable — the admin
    // strategy-review re-check (which admits warned) relies on this.
    const result = checkStrategyGate({
      ...BASE,
      computationStatus: "complete_with_warnings",
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBeNull();
  });

  it("rejects when there is no API key and no trades", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("NO_DATA_SOURCE");
    expect(result.reason).toMatch(/no API key/i);
  });

  it("allows a strategy with no API key when trades exist (CSV upload path)", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 12,
    });
    expect(result.passed).toBe(true);
  });

  // --- CSV-uploaded strategies (no API key, zero trades, history in
  //     csv_daily_returns). Regression for the un-approvable-CSV bug:
  //     the gate previously returned NO_DATA_SOURCE for every CSV strategy
  //     because it only counted the `trades` table. ---

  it("CSV strategy PASSES: no key, zero trades, enough csv rows, analytics complete", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 1112,
      seriesCompleteness: "user_supplied",
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBeNull();
  });

  it("CSV strategy is NOT gated by the 5-trade / 7-day-span trade thresholds", () => {
    // Zero trades + null trade span would trip INSUFFICIENT_TRADES/DAYS on the
    // exchange path; the CSV branch must ignore both.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 90,
      seriesCompleteness: "user_supplied",
    });
    expect(result.passed).toBe(true);
  });

  it("rejects a CSV strategy below the minimum row count", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 3,
      seriesCompleteness: "user_supplied",
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_CSV_HISTORY");
    expect(result.detail).toEqual({ rows: 3, min: STRATEGY_GATE_MIN_CSV_ROWS });
  });

  it("passes a CSV strategy at EXACTLY the minimum row count (7)", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: STRATEGY_GATE_MIN_CSV_ROWS,
      seriesCompleteness: "user_supplied",
    });
    expect(result.passed).toBe(true);
  });

  it("still rejects NO_DATA_SOURCE when there is no key, no trades, AND no csv rows", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("NO_DATA_SOURCE");
  });

  it("a CSV strategy still requires analytics to be complete", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 1112,
      seriesCompleteness: "user_supplied",
      computationStatus: "computing",
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("ANALYTICS_COMPUTING");
  });

  // --- MT5-11 / MT5-12: the daily-returns branch is decided by the PERSISTED
  //     completeness verdict, not by a hardcoded venue list. Keyed strategies
  //     whose venue folds a ledger into csv_daily_returns never populate
  //     `trades`, so they arrive with tradeCount 0; whether they may publish on
  //     that series is a question only the producer that wrote it can answer.
  //     Allow-list, hand-typed above: ledger_complete / user_supplied /
  //     composite_stitched. ---

  // ⭐ THE ACCEPTANCE TEST (D-15 / SC-1). This is the phase's single falsifiable
  //   safety property, and it is a REFUSAL, not a pass. MT5 being admitted is
  //   NOT the test — this perp still being refused is.
  it("⭐ D-15 ACCEPTANCE: keyed perp with an UNPROVEN fill-derived series + 135 csv rows + 0 trades is REFUSED", () => {
    // The economic situation, stated so the fixture is not just a string:
    // a perpetual-futures account whose realized-PnL fetch had an in-window
    // gap. `derive_broker_dailies` still produced 135 daily rows — but they
    // carry FUNDING ONLY, with the realized leg missing. Funding is typically a
    // small negative or positive drip; the account's actual trading P&L is
    // absent. Publishing this series would put a MATERIALLY UNDERSTATED track
    // record on a public factsheet under an "api_verified" badge.
    //
    // The trap is `computationStatus: "complete"`: the pipeline SUCCEEDED. Every
    // job is green, 135 rows exist, nothing errored. The only thing standing
    // between this strategy and publication is the verdict its producer stamped.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "key-1",
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      computationStatus: "complete",
      csvRowCount: 135,
      seriesCompleteness: "fill_derived_unproven",
    });
    expect(result.passed).toBe(false);
    // ⭐ 161-07 / WIZERR-10 RE-CUT THE CODE ASSERTION, DELIBERATELY, AND LEFT
    // THE SAFETY PROPERTY ALONE. The line above is what D-15 is about and it is
    // untouched: this perp is REFUSED, before and after.
    //
    // What moved is the DIAGNOSIS. `INSUFFICIENT_TRADES` carried the sentence
    // "Strategy has only 0 trade(s). A minimum of 5 trades is required." about
    // a strategy with 135 daily rows and zero fills by construction — false and
    // unwinnable, and the same class of sentence FIX 1 removed from the NULL
    // arm one commit earlier while deliberately leaving it here.
    //
    // FALSIFIABILITY OF THE RE-CUT ITSELF (the founder's rule applies to a
    // re-pointed oracle too): the production change was made FIRST and this
    // oracle was run against it unmodified. Observed:
    //   AssertionError: expected 'SERIES_EXAMINED_REFUSED' to be
    //   'INSUFFICIENT_TRADES'
    // — so the new routing is what this line now reads, not a value it would
    // have reported either way.
    expect(result.code).toBe("SERIES_EXAMINED_REFUSED");
    // …and the sentence it carries is about the SERIES, never the trade count.
    expect(result.reason).not.toMatch(/minimum of 5 trades/i);
    expect(result.reason).not.toMatch(/only 0 trade/i);
  });

  // ── 142.2 review FIX 1 — THE REFUSAL THAT REINTRODUCED THE PHASE'S OWN BUG ──
  //
  // The acceptance test above is a REFUSAL and must stay one. But refusing is
  // only half the obligation: the sentence has to be TRUE. The migration is
  // additive with NO BACKFILL (backfilling is forbidden — it would fabricate a
  // trust claim about series whose inputs no longer exist), so every
  // pre-existing analytics row reads NULL. Fail-closed routed all of them to the
  // trade branch, where a keyed Deribit/MT5 strategy with 135 daily rows and 0
  // trades was told "Strategy has only 0 trade(s). A minimum of 5 trades is
  // required." That is verbatim the false, unwinnable message the phase was
  // opened to delete, and the wizard's remedy for it deletes the draft.
  //
  // The fix is to the DIAGNOSIS, not the data: a never-examined series is not a
  // trade shortage. PROD census at review time: 6 unpublished strategies
  // affected (1 keyed, 4 keyless CSV, 1 composite), 0 published.

  it("⭐ FIX 1: a NULL verdict never renders the false 'minimum of 5 trades' sentence", () => {
    // The regression stated as the SENTENCE rather than the code, because the
    // sentence is what the user reads and what made the bug a dead end. A future
    // refactor that renames the code but restores the copy still reds here.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "key-mt5",
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      computationStatus: "complete",
      csvRowCount: 135,
      seriesCompleteness: null,
    });

    expect(result.passed).toBe(false);
    expect(result.reason).not.toMatch(/minimum of 5 trades is required/i);
    expect(result.reason).not.toMatch(/only 0 trade/i);
    // …and it says something TRUE and actionable instead. Hand-typed needles.
    expect(result.reason).toMatch(/135 day\(s\) of daily returns/i);
    expect(result.reason).toMatch(/re-sync/i);
    expect(result.detail).toEqual({ rows: 135 });
  });

  it("FIX 1: the split is 'did a producer look?', NOT 'do we like the answer?'", () => {
    // The discriminating pair, in one test so the boundary cannot drift by
    // halves. Both refuse — this is never an admission question — but they
    // refuse with DIFFERENT sentences, because one of them can say what the
    // record says and the other has no record to report.
    //
    // ⭐ 161-07 / WIZERR-10 RE-CUT THE EXAMINED HALF'S CODE, DELIBERATELY. The
    // `must refuse` assertion below is FIX 1's actual property and is unchanged
    // on both halves; only the examined half's expected code moved, off the
    // trade-branch fallthrough this test used to pin. Observed RED when this
    // oracle was run, unmodified, against the changed production code:
    //   AssertionError: fill_derived_unproven was EXAMINED and found wanting:
    //   expected 'SERIES_EXAMINED_REFUSED' to be 'INSUFFICIENT_TRADES'
    const examined = ["fill_derived_unproven", "sampled_gapped"];
    const notExamined = [null, "", "some_verdict_invented_next_year"];

    for (const verdict of examined) {
      const result = checkStrategyGate({
        ...BASE,
        apiKeyId: "key-1",
        tradeCount: 0,
        earliestTradeAt: null,
        latestTradeAt: null,
        csvRowCount: 135,
        seriesCompleteness: verdict,
      });
      expect(result.passed, `${verdict} must refuse`).toBe(false);
      expect(result.code, `${verdict} was EXAMINED and found wanting`).toBe(
        "SERIES_EXAMINED_REFUSED",
      );
      // The sentence differs PER VERDICT — the two must not collapse to one
      // generic string, which is what a Set-plus-default lookup would produce.
      expect(result.reason, `${verdict} must carry its own sentence`).toBe(
        verdict === "fill_derived_unproven"
          ? "The return series is derived from individual fills, which cannot establish that the record is complete."
          : "The return series is built from sampled balance snapshots with interior gaps, so it is not a complete record.",
      );
    }

    for (const verdict of notExamined) {
      const result = checkStrategyGate({
        ...BASE,
        apiKeyId: "key-1",
        tradeCount: 0,
        earliestTradeAt: null,
        latestTradeAt: null,
        csvRowCount: 135,
        seriesCompleteness: verdict,
      });
      expect(result.passed, `${verdict} must refuse`).toBe(false);
      expect(result.code, `${verdict} means NOBODY LOOKED`).toBe(
        "SERIES_PROVENANCE_UNVERIFIED",
      );
    }
  });

  it("FIX 1 changes NO admission: every verdict that passed still passes, every refusal still refuses", () => {
    // The safety half, stated over the whole verdict vocabulary plus the two
    // unrepresentable values. Adding a refusal code is exactly the kind of edit
    // that can accidentally open a branch, so the admission outcome is pinned
    // independently of which refusal code is returned.
    //
    // Hand-typed expectations — never derived from the gate's own allow-list.
    const expectations: [string | null, boolean][] = [
      ["ledger_complete", true],
      ["user_supplied", true],
      ["composite_stitched", true],
      ["fill_derived_unproven", false],
      ["sampled_gapped", false],
      [null, false],
      ["", false],
      ["not_a_verdict", false],
    ];

    for (const [verdict, shouldPass] of expectations) {
      const result = checkStrategyGate({
        ...BASE,
        apiKeyId: "key-1",
        tradeCount: 0,
        earliestTradeAt: null,
        latestTradeAt: null,
        computationStatus: "complete",
        csvRowCount: 135,
        seriesCompleteness: verdict,
      });
      expect(result.passed, `admission for verdict ${String(verdict)}`).toBe(
        shouldPass,
      );
    }
  });

  it("FIX 1 does not fire when there is no series to have provenance ABOUT", () => {
    // csvRowCount 0 → there is no daily series, so "we never recorded how this
    // series was built" would be a non-sequitur. A keyed strategy with 0 trades
    // and 0 daily rows is genuinely a trade-count story, and stays one.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "key-1",
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 0,
      seriesCompleteness: null,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_TRADES");
  });

  it("FIX 1 does not fire for a strategy that genuinely has trades", () => {
    // tradeCount > 0 → the trade floor is the honest verdict even if a daily
    // series also exists. The provenance arm is guarded on `tradeCount === 0`.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "key-1",
      tradeCount: 3,
      csvRowCount: 135,
      seriesCompleteness: null,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_TRADES");
    expect(result.detail).toEqual({ trades: 3, min: STRATEGY_GATE_MIN_TRADES });
  });

  it("keyed MT5 PASSES: ledger_complete + 135 csv rows + 0 trades (the MT5-11 unblock)", () => {
    // An MT5 deal ledger has no fills to fetch — `trades` is empty by
    // construction, not by failure — so the combiner can and does certify the
    // series complete. Before this phase this exact account landed on
    // INSUFFICIENT_TRADES with no winnable remedy.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "key-1",
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 135,
      seriesCompleteness: "ledger_complete",
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBeNull();
  });

  it("keyed ledger_complete below the CSV floor → INSUFFICIENT_CSV_HISTORY (not INSUFFICIENT_TRADES)", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "key-1",
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 3,
      seriesCompleteness: "ledger_complete",
    });
    expect(result.passed).toBe(false);
    // A certified series that is merely SHORT is a history problem, not a
    // trade-count problem: the daily-returns branch owns the verdict.
    expect(result.code).toBe("INSUFFICIENT_CSV_HISTORY");
    expect(result.detail).toEqual({ rows: 3, min: STRATEGY_GATE_MIN_CSV_ROWS });
  });

  it("SC-2 FAIL-CLOSED: seriesCompleteness null (never examined) + keyed + 135 rows → REFUSED", () => {
    // The allow-list is POSITIVE for exactly this case. Under a deny-list
    // (`!== "sampled_gapped"`) NULL would pass, and NULL is the state of every
    // row no producer has stamped yet — i.e. the default, i.e. everything.
    //
    // ⚠️ 142.2 review FIX 1 CHANGED THE CODE, NOT THE SAFETY PROPERTY. The
    // refusal is what SC-2 pins and it is unchanged and asserted first. What
    // changed is the DIAGNOSIS: this used to answer INSUFFICIENT_TRADES, whose
    // sentence ("only 0 trade(s), a minimum of 5 is required") is false about a
    // ledger-backed strategy with 135 daily rows and zero fills by
    // construction — verbatim the message this phase exists to delete. Since
    // the migration is additive with no backfill, EVERY pre-existing row reads
    // NULL and hit it.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "key-1",
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 135,
      seriesCompleteness: null,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("SERIES_PROVENANCE_UNVERIFIED");
    // The sentence must not blame the trade count for a provenance problem.
    expect(result.reason).not.toMatch(/minimum of 5 trades/i);
  });

  it("sampled_gapped → examined-refused → REFUSED (a gapped NAV sample is not a complete series)", () => {
    // ⭐ A THIRD ORACLE RE-CUT AT 161-07, and it was NOT in the plan's list of
    // two — the intermediate RED run is what surfaced it. Recorded because
    // "the plan named two" is exactly the reasoning that leaves a third pinning
    // deleted behaviour. Observed, unmodified, against the changed production
    // code: `AssertionError: expected 'SERIES_EXAMINED_REFUSED' to be
    // 'INSUFFICIENT_TRADES'`.
    //
    // The refusal is the property; the title's "trade branch" was a claim about
    // the ROUTE and is now false, so the title moved with the assertion.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "key-1",
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 135,
      seriesCompleteness: "sampled_gapped",
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("SERIES_EXAMINED_REFUSED");
  });

  it("an UNRECOGNISED verdict a future producer might invent → REFUSED (allow-list, not deny-list)", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "key-1",
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 135,
      seriesCompleteness: "some_verdict_invented_next_year",
    });
    expect(result.passed).toBe(false);
    // Still refused (the safety property). A verdict this module has not been
    // taught is, from here, indistinguishable from nobody having looked — so it
    // gets the provenance answer and its re-sync remedy rather than a false
    // claim about the trade count. Drift lands on a refusal either way.
    expect(result.code).toBe("SERIES_PROVENANCE_UNVERIFIED");
  });

  it("COMPOSITE (apiKeyId null) with composite_stitched PASSES — composites stay publishable", () => {
    // Composites have no api_key_id and passed historically via the
    // `!apiKeyId` term this phase deleted. They now depend on the stitch job
    // stamping a verdict. If this case ever reds, no composite can be approved.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 400,
      seriesCompleteness: "composite_stitched",
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBeNull();
  });

  it("COMPOSITE with a NULL verdict is REFUSED — the new dependency on the stitch stamp, stated", () => {
    // Documents the cost of deleting `!apiKeyId`: keylessness alone no longer
    // admits anything. A composite whose stitch job did not stamp is refused,
    // and the remedy is a re-stitch, never a backfill.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 400,
      seriesCompleteness: null,
    });
    expect(result.passed).toBe(false);
    // 142.2 review FIX 1 — refusal unchanged; the code now names the real
    // problem. "A minimum of 5 trades is required" was never a sentence a
    // composite could act on: composites have zero trades BY CONSTRUCTION, so
    // the old code stated an unreachable condition as the remedy. The re-stitch
    // this test's own comment calls for is what the new copy actually offers.
    expect(result.code).toBe("SERIES_PROVENANCE_UNVERIFIED");
  });

  it("NO_DATA_SOURCE guard is UNCHANGED: keyless, 0 trades, 0 csv rows → NO_DATA_SOURCE (not a verdict question)", () => {
    // The guard keys off `!apiKeyId` and always did; apiKeyId left the
    // daily-branch predicate, not the input type. A strategy with nothing at
    // all must still say so, whatever its verdict column holds.
    for (const verdict of [null, "user_supplied", "ledger_complete"]) {
      const result = checkStrategyGate({
        ...BASE,
        apiKeyId: null,
        tradeCount: 0,
        earliestTradeAt: null,
        latestTradeAt: null,
        csvRowCount: 0,
        seriesCompleteness: verdict,
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe("NO_DATA_SOURCE");
    }
  });

  it("keyed perp WITH trades stays on the trade branch (no regression)", () => {
    // tradeCount > 0 → NOT daily-returns-sourced even if csvRowCount is set;
    // the perp trade-count floor still governs.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "ak-perp",
      tradeCount: 3,
      csvRowCount: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_TRADES");
    expect(result.detail).toEqual({ trades: 3, min: STRATEGY_GATE_MIN_TRADES });
  });

  it("rejects below the minimum trade count", () => {
    const result = checkStrategyGate({ ...BASE, tradeCount: 3 });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_TRADES");
    expect(result.detail).toEqual({ trades: 3, min: STRATEGY_GATE_MIN_TRADES });
  });

  it("passes at EXACTLY the minimum trade count (5)", () => {
    const result = checkStrategyGate({ ...BASE, tradeCount: STRATEGY_GATE_MIN_TRADES });
    expect(result.passed).toBe(true);
  });

  it("rejects below the minimum day span", () => {
    const result = checkStrategyGate({
      ...BASE,
      earliestTradeAt: new Date("2026-04-05T00:00:00Z"),
      latestTradeAt: new Date("2026-04-09T00:00:00Z"), // 4 days
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_DAYS");
    expect(result.detail?.days).toBeLessThan(STRATEGY_GATE_MIN_DAYS);
  });

  it("passes at EXACTLY 7.0 days span (boundary case, matches historic behavior)", () => {
    // Seven full days: 2026-04-01T00:00 to 2026-04-08T00:00
    const result = checkStrategyGate({
      ...BASE,
      earliestTradeAt: new Date("2026-04-01T00:00:00Z"),
      latestTradeAt: new Date("2026-04-08T00:00:00Z"),
    });
    expect(result.passed).toBe(true);
  });

  it("rejects when analytics row is missing", () => {
    const result = checkStrategyGate({ ...BASE, computationStatus: null });
    expect(result.code).toBe("ANALYTICS_MISSING");
  });

  it("rejects when analytics are pending", () => {
    const result = checkStrategyGate({ ...BASE, computationStatus: "pending" });
    expect(result.code).toBe("ANALYTICS_PENDING");
  });

  it("rejects when analytics are still computing", () => {
    const result = checkStrategyGate({ ...BASE, computationStatus: "computing" });
    expect(result.code).toBe("ANALYTICS_COMPUTING");
  });

  it("rejects and surfaces the error detail when analytics failed", () => {
    const result = checkStrategyGate({
      ...BASE,
      computationStatus: "failed",
      computationError: "Railway fetch timed out",
    });
    expect(result.code).toBe("ANALYTICS_FAILED");
    expect(result.reason).toContain("Railway fetch timed out");
    expect(result.detail).toEqual({ error: "Railway fetch timed out" });
  });

  it("rejects analytics-failed without an error message gracefully", () => {
    const result = checkStrategyGate({
      ...BASE,
      computationStatus: "failed",
      computationError: null,
    });
    expect(result.code).toBe("ANALYTICS_FAILED");
    expect(result.reason).not.toContain("undefined");
    expect(result.detail).toBeNull();
  });

  it("rejects just below the 7-day boundary (6.99 days) — pins < STRATEGY_GATE_MIN_DAYS", () => {
    // M-0572: the historic inline gate used `< 7`; the helper uses
    // `< STRATEGY_GATE_MIN_DAYS`. A future tweak to `<=` would silently
    // shift the threshold by a day, so pin 6.99 days as a rejection.
    const earliest = new Date("2026-04-01T00:00:00Z");
    const latest = new Date(
      earliest.getTime() + 6.99 * 24 * 60 * 60 * 1000,
    );
    const result = checkStrategyGate({
      ...BASE,
      earliestTradeAt: earliest,
      latestTradeAt: latest,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_DAYS");
    expect(result.detail?.days).toBe(6.99);
  });

  it("passes just above the 7-day boundary (7.01 days)", () => {
    const earliest = new Date("2026-04-01T00:00:00Z");
    const latest = new Date(
      earliest.getTime() + 7.01 * 24 * 60 * 60 * 1000,
    );
    const result = checkStrategyGate({
      ...BASE,
      earliestTradeAt: earliest,
      latestTradeAt: latest,
    });
    expect(result.passed).toBe(true);
  });

  // --- C-3 (140.4-01): the gate REFUSES to evaluate an unrepresentable span.
  //
  //     TRAP-9 swap. Two cases previously pinned the OPPOSITE contract:
  //       "skips the day-span check when latest < earliest (computeSpanDays
  //        returns null on negative delta)"  → expected passed:true
  //       "skips day-span check when trade timestamps are missing"
  //                                          → expected passed:true
  //     Both asserted the fall-through this plan closes: with trades present
  //     and the span unreadable the gate answered PASS, so a read failure on
  //     the earliest/latest probes published an under-history track record as
  //     verified. Each is replaced below by the strictly stronger assertion
  //     that the gate REFUSES (throws) rather than returning a verdict. ---

  it("REFUSES (throws) when trades exist but the timestamps are missing — the C-3 publish-side fail-open", () => {
    // Replaces "skips day-span check when trade timestamps are missing".
    // StrategyGateInput's own docstring says earliestTradeAt/latestTradeAt are
    // "null when no trades exist" — so null HERE, with tradeCount >= the trade
    // floor, is a contradiction, not an absence. Previously this returned
    // { passed: true, code: null } and the 7-day gate was skipped entirely.
    expect(() =>
      checkStrategyGate({
        ...BASE,
        tradeCount: 5,
        earliestTradeAt: null,
        latestTradeAt: null,
      }),
    ).toThrow(/unreadable/i);
  });

  it("REFUSES (throws) when latest < earliest — a corrupt span is unrepresentable, not a pass", () => {
    // Replaces "skips the day-span check when latest < earliest ...". Same
    // contradiction: trades demonstrably exist, the span cannot be computed.
    expect(() =>
      checkStrategyGate({
        ...BASE,
        earliestTradeAt: new Date("2026-04-10T00:00:00Z"),
        latestTradeAt: new Date("2026-04-01T00:00:00Z"), // earlier than earliest
      }),
    ).toThrow(/unreadable/i);
  });

  it("the refusal is a named error whose message states the contradiction and leaks no user data", () => {
    let caught: unknown;
    try {
      checkStrategyGate({
        ...BASE,
        tradeCount: 5,
        earliestTradeAt: new Date("2026-04-10T00:00:00Z"),
        latestTradeAt: new Date("2026-04-01T00:00:00Z"),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    // Exported from the module under test so callers can narrow on it.
    expect(caught).toBeInstanceOf(StrategyGateUnevaluableError);
    expect((caught as Error).name).toBe("StrategyGateUnevaluableError");
    // Names BOTH halves of the contradiction: trades present, span unreadable.
    expect((caught as Error).message).toMatch(/5 trade/);
    expect((caught as Error).message).toMatch(/unreadable/i);
    // No user data: not the timestamps it was handed, not the api key id.
    expect((caught as Error).message).not.toContain("2026-04-10");
    expect((caught as Error).message).not.toContain("2026-04-01");
    expect((caught as Error).message).not.toContain("ak-1");
  });

  it("does NOT refuse when tradeCount is 0 and the timestamps are null — a genuine absence", () => {
    // The case that distinguishes this fix from a blanket null-ban: with zero
    // trades the null timestamps are exactly what the docstring describes, and
    // the trade-count floor answers first.
    const result = checkStrategyGate({
      ...BASE,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_TRADES");
  });

  it("does NOT refuse on the daily-returns branch with null timestamps (keyless CSV / certified keyed series)", () => {
    expect(() =>
      checkStrategyGate({
        ...BASE,
        apiKeyId: null,
        tradeCount: 0,
        earliestTradeAt: null,
        latestTradeAt: null,
        csvRowCount: 90,
        seriesCompleteness: "user_supplied",
      }),
    ).not.toThrow();
    expect(() =>
      checkStrategyGate({
        ...BASE,
        apiKeyId: "key-1",
        tradeCount: 0,
        earliestTradeAt: null,
        latestTradeAt: null,
        csvRowCount: 30,
        seriesCompleteness: "ledger_complete",
      }),
    ).not.toThrow();
  });

  it("a readable 2-day span with 5 trades still returns INSUFFICIENT_DAYS (verdict unchanged)", () => {
    const result = checkStrategyGate({
      ...BASE,
      tradeCount: 5,
      earliestTradeAt: new Date("2026-04-01T00:00:00Z"),
      latestTradeAt: new Date("2026-04-03T00:00:00Z"),
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_DAYS");
    expect(result.detail).toEqual({ days: 2, min: 7 });
  });

  it("a readable 7.0-day span with 5 trades still passes (documented boundary unchanged)", () => {
    const result = checkStrategyGate({
      ...BASE,
      tradeCount: 5,
      earliestTradeAt: new Date("2026-04-01T00:00:00Z"),
      latestTradeAt: new Date("2026-04-08T00:00:00Z"),
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBeNull();
  });
});

/**
 * [161-07 / WIZERR-10] THE FOURTH OUTCOME, AND THE THREE PROPERTIES IT MUST NOT
 * COST.
 *
 * A gapped or fill-derived strategy with a full daily-return series and zero
 * fills BY CONSTRUCTION used to be told "Strategy has only 0 trade(s). A
 * minimum of 5 trades is required." That sentence is false about the strategy
 * and unwinnable for the user, and it is the same defect FIX 1 removed from the
 * never-examined arm while deliberately leaving it here.
 *
 * ⛔ THE THREE THINGS THAT MUST SURVIVE THE CHANGE, each with a case below:
 *   1. THE REFUSAL. Every input refused before is refused after —
 *      `passed === false` is asserted on the new arm explicitly, so an edit that
 *      turns the fourth outcome into an admission reds here rather than
 *      publishing an unproven track record.
 *   2. MUTUAL EXCLUSIVITY. Adding a fourth arm must not make two arms reachable
 *      for one input.
 *   3. THE GENUINE TRADE SHORTAGE. A strategy that really is short of trades
 *      still answers INSUFFICIENT_TRADES with its sentence byte-identical.
 *
 * ORACLE INDEPENDENCE, restated because this block asserts SENTENCES: every
 * expected string is hand-typed. Nothing is imported from `strategyGate.ts` —
 * importing the map under test would let a rewritten sentence certify itself.
 */
describe("[161-07 / WIZERR-10] examined-but-refused verdicts get their own truthful outcome", () => {
  /** The two verdicts `broker_dailies.py` stamps that do not earn admission. */
  const EXAMINED_REFUSED = ["fill_derived_unproven", "sampled_gapped"] as const;

  const dailyReturnsInput = (verdict: string | null) => ({
    ...BASE,
    apiKeyId: "key-1",
    tradeCount: 0,
    earliestTradeAt: null,
    latestTradeAt: null,
    computationStatus: "complete" as const,
    csvRowCount: 135,
    seriesCompleteness: verdict,
  });

  it("THE REFUSAL PROPERTY: the fourth outcome refuses — it is never an admission", () => {
    // Asserted separately from the code, and first. A future edit that keeps
    // the code and flips the decision is the dangerous one: it publishes a
    // track record whose completeness its own producer declined to establish.
    for (const verdict of EXAMINED_REFUSED) {
      const result = checkStrategyGate(dailyReturnsInput(verdict));
      expect(result.passed, `${verdict} must never be admitted`).toBe(false);
      expect(result.code).toBe("SERIES_EXAMINED_REFUSED");
    }
  });

  it("MUTUAL EXCLUSIVITY: no single input reaches two of the four outcomes", () => {
    // One input per outcome, each naming the condition that selects it. The
    // oracle is that the four inputs produce four DISTINCT codes: if adding the
    // fourth arm had made two reachable for one input, the arm order would
    // decide the answer and one of these codes would go missing.
    const cases: { label: string; input: StrategyGateInput; code: string }[] = [
      {
        label: "admitted verdict, below the 7-day floor",
        input: { ...dailyReturnsInput("ledger_complete"), csvRowCount: 3 },
        code: "INSUFFICIENT_CSV_HISTORY",
      },
      {
        label: "no verdict at all — nobody looked",
        input: dailyReturnsInput(null),
        code: "SERIES_PROVENANCE_UNVERIFIED",
      },
      {
        label: "a verdict was recorded and does not earn admission",
        input: dailyReturnsInput("fill_derived_unproven"),
        code: "SERIES_EXAMINED_REFUSED",
      },
      {
        label: "no daily series at all — a genuine trade shortage",
        input: { ...dailyReturnsInput(null), csvRowCount: 0 },
        code: "INSUFFICIENT_TRADES",
      },
    ];

    const seen: string[] = [];
    for (const c of cases) {
      const result = checkStrategyGate(c.input);
      expect(result.passed, `${c.label} must refuse`).toBe(false);
      expect(result.code, c.label).toBe(c.code);
      seen.push(result.code as string);
    }
    expect(
      new Set(seen).size,
      "Two of the four inputs produced the same code — the outcomes are no " +
        "longer mutually exclusive and arm ORDER is now deciding the answer.",
    ).toBe(4);
  });

  it("THE GENUINE TRADE SHORTAGE keeps its sentence, byte-identical", () => {
    // The anti-over-reach half. Without it, "route everything away from the
    // trade floor" would satisfy every case above and delete a refusal that is
    // both true and correctly worded.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "key-1",
      tradeCount: 2,
      earliestTradeAt: new Date("2026-04-01T00:00:00Z"),
      latestTradeAt: new Date("2026-04-10T00:00:00Z"),
      csvRowCount: 0,
      seriesCompleteness: null,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_TRADES");
    expect(result.reason).toBe(
      "Strategy has only 2 trade(s). A minimum of 5 trades is required.",
    );
  });

  it("each sentence is TRUE OF ITS PRODUCER — no invented threshold, no invented examination", () => {
    // ⭐ THE TRUTH OBLIGATION, as a test rather than as a promise. Both clauses
    // 161-UI-SPEC proposed were measured against
    // `analytics-service/services/broker_dailies.py`'s producer registry and
    // both were WRONG; these assertions are what stops either coming back.
    const gapped = checkStrategyGate(dailyReturnsInput("sampled_gapped"));
    const derived = checkStrategyGate(
      dailyReturnsInput("fill_derived_unproven"),
    );

    // NON-VACUITY FLOOR: `"anything".includes("")` is true, so a null or empty
    // reason would satisfy every negative below.
    for (const r of [gapped.reason, derived.reason]) {
      expect(typeof r, "reason must be a string").toBe("string");
      expect((r ?? "").length).toBeGreaterThan(60);
    }

    // ⛔ NO SIZE THRESHOLD. `sampled_gapped` is stamped whenever
    // `nav_gap_days > 0` — ANY interior hole. The UI-SPEC's "gaps too large to
    // verify" asserts a magnitude test the producer does not perform and is
    // false of a one-day hole.
    expect(gapped.reason).not.toMatch(/too large/i);
    expect(gapped.reason).not.toMatch(/too many/i);
    expect(gapped.reason).toMatch(/sampled balance snapshots/i);

    // ⛔ NO PER-SERIES EXAMINATION CLAIM. `fill_derived_unproven` is stamped
    // for binance / bybit / okx ALWAYS and unconditionally — "a CONSTANT, not a
    // data-driven refinement", in the producer's own words. The UI-SPEC's
    // "was examined and refused" implies a finding about THIS series.
    expect(derived.reason).not.toMatch(/examined and refused/i);
    expect(derived.reason).not.toMatch(/found wanting/i);
    expect(derived.reason).toMatch(/derived from individual fills/i);

    // ⛔ NO MAGNITUDE ON THIS CHANNEL (T-73-02 / T-74-03 leak discipline — the
    // producer keeps gap-day counts off the verdict key for the same reason).
    for (const r of [gapped.reason ?? "", derived.reason ?? ""]) {
      expect(r).not.toMatch(/\d+ day/i);
      expect(r).not.toMatch(/\d+ gap/i);
    }
  });

  it("each sentence reads as a complete sentence after the admin prefix", () => {
    // `admin/strategy-review` answers `Cannot approve: ${gate.reason}` RAW,
    // with no copy hop, so the reason IS the operator-visible string. A
    // fragment, or a lowercase start, reads as a broken sentence there.
    for (const verdict of EXAMINED_REFUSED) {
      const reason = checkStrategyGate(dailyReturnsInput(verdict)).reason ?? "";
      const rendered = `Cannot approve: ${reason}`;
      expect(rendered, verdict).toMatch(/^Cannot approve: [A-Z]/);
      expect(rendered, verdict).toMatch(/\.$/);
    }
  });

  it("the two verdicts do NOT share one generic sentence", () => {
    // The anti-collapse pin. A Set plus a single default string would satisfy
    // every other case in this describe while telling an sFOX user about fills
    // and a perp user about balance snapshots.
    const a = checkStrategyGate(dailyReturnsInput("fill_derived_unproven"));
    const b = checkStrategyGate(dailyReturnsInput("sampled_gapped"));
    expect(a.reason).not.toBe(b.reason);
  });
});
