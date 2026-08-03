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
    expect(result.code).toBe("INSUFFICIENT_TRADES");
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

  it("SC-2 FAIL-CLOSED: seriesCompleteness null (never examined) + keyed + 135 rows → trade branch → REFUSED", () => {
    // The allow-list is POSITIVE for exactly this case. Under a deny-list
    // (`!== "sampled_gapped"`) NULL would pass, and NULL is the state of every
    // row no producer has stamped yet — i.e. the default, i.e. everything.
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
    expect(result.code).toBe("INSUFFICIENT_TRADES");
  });

  it("sampled_gapped → trade branch → REFUSED (a gapped NAV sample is not a complete series)", () => {
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
    expect(result.code).toBe("INSUFFICIENT_TRADES");
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
    expect(result.code).toBe("INSUFFICIENT_TRADES");
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
    expect(result.code).toBe("INSUFFICIENT_TRADES");
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
