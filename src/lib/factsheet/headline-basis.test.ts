import { describe, it, expect } from "vitest";
import {
  GUARD_REASON_PHRASES,
  headlineVerdict,
  joinGuardPhrases,
  readHeadlineBasis,
  storedCashHeadlineGate,
} from "./headline-basis";
import type { GuardReason, StoredCashHeadlineGate } from "./headline-basis";

/**
 * Phase 164.6.6.3.3 (D-01, D-03) — the pure reader that turns a row's
 * `data_quality_flags` into "which span does the stored headline cover, and why
 * did the chain break". The phrases are public text (UI-SPEC §1.2) and are typed
 * here by hand, so a change to the table must change this oracle too.
 */
describe("readHeadlineBasis", () => {
  it("a dated chain-broken row names its span and its reasons, in table order", () => {
    expect(
      readHeadlineBasis({
        twr_chain_broken: true,
        headline_since: "2026-04-18",
        dust_nav_guard: true,
        flow_dominated_guard: true,
        negative_nav_guard: true,
      }),
    ).toEqual({
      twrChainBroken: true,
      headlineSince: "2026-04-18",
      reasons: ["negative_nav", "dust_nav", "flow_dominated"],
      withheld: false,
    });
  });

  it("carries all four reasons in the UI-SPEC order", () => {
    expect(
      readHeadlineBasis({
        twr_chain_broken: true,
        headline_since: "2026-04-18",
        pnl_dominated_guard: true,
        flow_dominated_guard: true,
        dust_nav_guard: true,
        negative_nav_guard: true,
      }).reasons,
    ).toEqual(["negative_nav", "dust_nav", "flow_dominated", "pnl_dominated"]);
  });

  it.each([["true"], [1], [{}], [[true]], [null]])(
    "a guard flag spelled %j never counts (strict === true)",
    (flag) => {
      const out = readHeadlineBasis({
        twr_chain_broken: true,
        headline_since: "2026-04-18",
        dust_nav_guard: flag,
      });
      expect(out.reasons).toEqual([]);
    },
  );

  it.each([["true"], [1], [{}]])("twr_chain_broken spelled %j is a clean row", (flag) => {
    expect(readHeadlineBasis({ twr_chain_broken: flag, headline_since: "2026-04-18" })).toEqual({
      twrChainBroken: false,
      headlineSince: null,
      reasons: [],
      withheld: false,
    });
  });

  it.each([
    ["a number", 20260418],
    ["a non-padded date", "2026-4-18"],
    ["an impossible date", "2026-02-30"],
    ["a slash date", "18/04/2026"],
    ["null", null],
    ["absent", undefined],
    ["an object", {}],
    ["a datetime", "2026-04-18T00:00:00Z"],
  ])("a chain-broken row with headline_since as %s is Withheld, never undated", (_label, since) => {
    const out = readHeadlineBasis({ twr_chain_broken: true, headline_since: since });
    expect(out.headlineSince).toBeNull();
    expect(out.withheld).toBe(true);
    expect(out.twrChainBroken).toBe(true);
  });

  it("a headline_since on a row WITHOUT twr_chain_broken is ignored: no date, not withheld", () => {
    expect(readHeadlineBasis({ headline_since: "2026-04-18" })).toEqual({
      twrChainBroken: false,
      headlineSince: null,
      reasons: [],
      withheld: false,
    });
  });

  it.each([[null], [undefined], ["x"], [[]], [42]])("a non-object flags value %j is a clean row", (dqf) => {
    expect(readHeadlineBasis(dqf).twrChainBroken).toBe(false);
    expect(readHeadlineBasis(dqf).withheld).toBe(false);
  });

  it("reasons are only ever read on a chain-broken row", () => {
    expect(readHeadlineBasis({ dust_nav_guard: true }).reasons).toEqual([]);
  });
});

describe("joinGuardPhrases (UI-SPEC §1.2 join rule)", () => {
  it("pins the four public phrases verbatim", () => {
    expect(GUARD_REASON_PHRASES).toEqual({
      negative_nav: "a zero or negative account balance",
      dust_nav: "a near-zero account balance",
      flow_dominated: "a deposit or withdrawal larger than the balance",
      pnl_dominated: "a one-day gain or loss larger than the balance",
    });
  });

  it("zero reasons: the no-cause phrase", () => {
    expect(joinGuardPhrases([])).toBe("a break in the return chain");
  });

  it("one reason stands alone", () => {
    expect(joinGuardPhrases(["dust_nav"])).toBe("a near-zero account balance");
  });

  it("two reasons are joined with ' and '", () => {
    expect(joinGuardPhrases(["negative_nav", "flow_dominated"])).toBe(
      "a zero or negative account balance and a deposit or withdrawal larger than the balance",
    );
  });

  it("three reasons: commas and a final ' and '", () => {
    expect(joinGuardPhrases(["negative_nav", "dust_nav", "flow_dominated"])).toBe(
      "a zero or negative account balance, a near-zero account balance and a deposit or withdrawal larger than the balance",
    );
  });

  it("four reasons: commas and a final ' and '", () => {
    const all: GuardReason[] = ["negative_nav", "dust_nav", "flow_dominated", "pnl_dominated"];
    expect(joinGuardPhrases(all)).toBe(
      "a zero or negative account balance, a near-zero account balance, a deposit or withdrawal larger than the balance and a one-day gain or loss larger than the balance",
    );
  });
});

/**
 * SFH-R2-01 — the ONE headline verdict the page and the OG card share. The
 * oracles are typed by hand from D-03: a chain-broken row is Dated only when its
 * stored headline is applicable AND carries a valid `headline_since`.
 */
describe("headlineVerdict", () => {
  const DATED = { twr_chain_broken: true, headline_since: "2025-09-01" };
  const OK = { applicable: true } as const;
  const NOT_RANKABLE = { applicable: false, reason: "not_rankable" } as const;

  it("not chain-broken is clean whether or not a stored headline is applicable", () => {
    for (const dqf of [undefined, null, {}, { twr_chain_broken: false }, { twr_chain_broken: "true" }, { headline_since: "2025-09-01" }]) {
      expect(headlineVerdict(dqf, OK)).toEqual({ kind: "clean" });
      expect(headlineVerdict(dqf, NOT_RANKABLE, "failed")).toEqual({ kind: "clean" });
    }
  });

  it("chain-broken with an applicable headline and a valid marker is dated", () => {
    expect(headlineVerdict(DATED, OK, "complete")).toEqual({ kind: "dated", since: "2025-09-01" });
  });

  it.each([
    ["absent", { twr_chain_broken: true }],
    ["null", { twr_chain_broken: true, headline_since: null }],
    ["malformed", { twr_chain_broken: true, headline_since: "2025-02-30" }],
  ])("chain-broken with an applicable headline and a %s marker is withheld, unmeasured", (_n, dqf) => {
    expect(headlineVerdict(dqf, OK, "complete")).toEqual({ kind: "withheld", cause: "unmeasured" });
  });

  it("chain-broken with NO applicable stored headline is withheld even with a valid marker", () => {
    expect(headlineVerdict(DATED, { applicable: false, reason: "raw_cash_settlement" }, "complete").kind).toBe("withheld");
  });

  // D-14 (founder, 2026-10-10, review round 2 R2-03): the CAUSE of a withheld
  // verdict. Hand-typed from the decision, not derived from the code.
  describe("D-14 — the withhold cause", () => {
    it.each([
      ["computing", "recomputing"],
      ["pending", "recomputing"],
      ["failed", "failed"],
    ])("a Dated row whose analytics are %s is withheld as %s", (status, cause) => {
      expect(headlineVerdict(DATED, NOT_RANKABLE, status)).toEqual({ kind: "withheld", cause });
    });

    it.each([[null], [undefined], ["archived"], [7]])(
      "a not-rankable row with an unrecognised status (%s) keeps the original cause, unmeasured",
      (status) => {
        expect(headlineVerdict(DATED, NOT_RANKABLE, status)).toEqual({ kind: "withheld", cause: "unmeasured" });
      },
    );

    it.each<[string, StoredCashHeadlineGate]>([
      ["no_row", { applicable: false, reason: "no_row" }],
      ["raw_cash_settlement", { applicable: false, reason: "raw_cash_settlement" }],
      ["missing_keys", { applicable: false, reason: "missing_keys", missing: ["cagr"] }],
    ])("%s is unmeasured whatever the status says: D-14 does not cover it", (_n, gate) => {
      for (const status of ["computing", "failed", "complete"]) {
        expect(headlineVerdict(DATED, gate, status)).toEqual({ kind: "withheld", cause: "unmeasured" });
      }
    });

    it.each(["computing", "pending", "failed"])(
      "a chain-broken row with NO valid headline_since stays unmeasured while %s: the original sentence remains",
      (status) => {
        expect(headlineVerdict({ twr_chain_broken: true }, NOT_RANKABLE, status)).toEqual({
          kind: "withheld",
          cause: "unmeasured",
        });
        expect(headlineVerdict({ twr_chain_broken: true, headline_since: "nope" }, NOT_RANKABLE, status)).toEqual({
          kind: "withheld",
          cause: "unmeasured",
        });
      },
    );
  });
});

describe("storedCashHeadlineGate", () => {
  const SEVEN = { cumulative_return: 1, volatility: 1, max_drawdown: 1, cagr: 1, sharpe: 1, sortino: 1, calmar: 1 };
  const ROW = { ...SEVEN, computation_status: "complete" };

  it("a rankable row with all seven keys and no raw cash object is applicable", () => {
    expect(storedCashHeadlineGate(ROW, null, "complete")).toEqual({ applicable: true });
    expect(storedCashHeadlineGate(ROW, { mtm: { sharpe: 1 } }, "complete")).toEqual({ applicable: true });
  });

  it("names each refusal", () => {
    expect(storedCashHeadlineGate(null, null, "complete")).toEqual({ applicable: false, reason: "no_row" });
    expect(storedCashHeadlineGate(undefined, null, "complete")).toEqual({ applicable: false, reason: "no_row" });
    for (const status of ["failed", "computing", null, undefined]) {
      expect(storedCashHeadlineGate(ROW, null, status)).toEqual({ applicable: false, reason: "not_rankable" });
    }
    expect(storedCashHeadlineGate(ROW, { cash_settlement: { sharpe: 1 } }, "complete")).toEqual({
      applicable: false,
      reason: "raw_cash_settlement",
    });
    const { cagr: _c, sortino: _s, ...unprojected } = ROW;
    expect(storedCashHeadlineGate(unprojected, null, "complete")).toEqual({
      applicable: false,
      reason: "missing_keys",
      missing: ["cagr", "sortino"],
    });
  });

  it("a key present with an undefined VALUE is projected (presence, as the page reads it)", () => {
    expect(storedCashHeadlineGate({ ...ROW, cagr: undefined }, null, "complete")).toEqual({ applicable: true });
  });
});
