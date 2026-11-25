import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// `composite-read-path` imports `server-only` (a Next.js RSC build guard); the 252 MT5 pins below
// call its `applyHeadlineBasis`.
vi.mock("server-only", () => ({}));

import {
  GUARD_REASON_PHRASES,
  OPTIONS_CASH_WALLET_CAUSE,
  OPTIONS_CASH_WALLET_PHRASES,
  OPTIONS_CASH_WALLET_REASON,
  headlineVerdict,
  isOptionsCashWalletBook,
  isOptionsCashWalletReason,
  isStoredResultReadable,
  joinGuardPhrases,
  readHeadlineBasis,
  storedCashHeadlineGate,
} from "./headline-basis";
import type { GuardReason, StoredCashHeadlineGate } from "./headline-basis";
import { applyHeadlineBasis } from "./composite-read-path";
import { computeOgHeadline } from "./og-metrics";

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
        pnl_dominated_guard: true,
        dust_nav_guard: true,
        negative_nav_guard: true,
      }),
    ).toEqual({
      twrChainBroken: true,
      headlineSince: "2026-04-18",
      reasons: ["negative_nav", "dust_nav", "pnl_dominated"],
      withheld: false,
    });
  });

  it("carries all three reasons in the UI-SPEC order, whatever order the flags were written in", () => {
    expect(
      readHeadlineBasis({
        twr_chain_broken: true,
        headline_since: "2026-04-18",
        pnl_dominated_guard: true,
        dust_nav_guard: true,
        negative_nav_guard: true,
      }).reasons,
    ).toEqual(["negative_nav", "dust_nav", "pnl_dominated"]);
  });

  // Phase 164.6.6.2.3 FLOWTIMING (D-05, D-14). Stored PROD rows keep the retired
  // flag until the recompute rewrites them; no page may print copy for it. These
  // fail if the retired flag is ever put back in the flag-to-reason table.
  it("D-14: a stored retired flow-dominance flag is ignored and names no reason", () => {
    const out = readHeadlineBasis({
      twr_chain_broken: true,
      headline_since: "2026-04-18",
      flow_dominated_guard: true,
    });
    expect(out.reasons).toEqual([]);
    expect(out).toMatchObject({ twrChainBroken: true, headlineSince: "2026-04-18", withheld: false });
    expect(joinGuardPhrases(out.reasons)).toBe("a break in the return chain");
  });

  it("D-14: beside a real guard the retired flag is ignored and the real reason stays", () => {
    expect(
      readHeadlineBasis({
        twr_chain_broken: true,
        headline_since: "2026-04-18",
        negative_nav_guard: true,
        flow_dominated_guard: true,
      }).reasons,
    ).toEqual(["negative_nav"]);
  });

  it("D-14: no phrase in the public table speaks of a deposit or withdrawal", () => {
    expect(Object.values(GUARD_REASON_PHRASES).join(" | ")).not.toMatch(/deposit|withdrawal/);
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
  it("pins the three public phrases verbatim", () => {
    expect(GUARD_REASON_PHRASES).toEqual({
      negative_nav: "a zero or negative account balance",
      dust_nav: "a near-zero account balance",
      pnl_dominated: "a one-day gain or loss larger than the balance",
    });
  });

  it("zero reasons: the no-cause phrase", () => {
    expect(joinGuardPhrases([])).toBe("a break in the return chain");
  });

  // D-14: a payload cached before the retired reason left the table can still
  // carry it for the cache TTL. Fails if the unknown reason is printed.
  it("D-14: a cached retired reason is dropped, never printed as undefined", () => {
    const stale = ["negative_nav", "flow_dominated"] as unknown as GuardReason[];
    expect(joinGuardPhrases(stale)).toBe("a zero or negative account balance");
    expect(joinGuardPhrases(["flow_dominated"] as unknown as GuardReason[])).toBe("a break in the return chain");
  });

  it("one reason stands alone", () => {
    expect(joinGuardPhrases(["dust_nav"])).toBe("a near-zero account balance");
  });

  it("two reasons are joined with ' and '", () => {
    expect(joinGuardPhrases(["negative_nav", "pnl_dominated"])).toBe(
      "a zero or negative account balance and a one-day gain or loss larger than the balance",
    );
  });

  it("three reasons: commas and a final ' and '", () => {
    const all: GuardReason[] = ["negative_nav", "dust_nav", "pnl_dominated"];
    expect(joinGuardPhrases(all)).toBe(
      "a zero or negative account balance, a near-zero account balance and a one-day gain or loss larger than the balance",
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

/**
 * 188 D-02, D-04 - a realized-era tiny-day chain break is explained with the EXISTING
 * near-zero-balance phrase (no new headline copy). Two flags now map to one reason, so a
 * reason is named once. The expected phrase is typed by hand here.
 */
describe("188 tiny_base_guard - the headline reason for a tiny-base break", () => {
  const BROKEN = { twr_chain_broken: true, headline_since: "2026-04-18" };

  it("tiny_base_guard alone names the near-zero-balance reason", () => {
    const out = readHeadlineBasis({ ...BROKEN, tiny_base_guard: true });
    expect(out.reasons).toEqual(["dust_nav"]);
    expect(joinGuardPhrases(out.reasons)).toBe("a near-zero account balance");
  });

  it("dust_nav_guard and tiny_base_guard together name that reason exactly once", () => {
    const out = readHeadlineBasis({ ...BROKEN, dust_nav_guard: true, tiny_base_guard: true });
    expect(out.reasons).toEqual(["dust_nav"]);
    expect(joinGuardPhrases(out.reasons)).toBe("a near-zero account balance");
  });

  it("negative_nav, tiny_base and pnl_dominated together keep table order, first occurrence", () => {
    expect(
      readHeadlineBasis({
        ...BROKEN,
        pnl_dominated_guard: true,
        tiny_base_guard: true,
        negative_nav_guard: true,
      }).reasons,
    ).toEqual(["negative_nav", "dust_nav", "pnl_dominated"]);
  });

  it.each([["true"], [1], [null], [false]])("tiny_base_guard %j does not count (strict === true)", (v) => {
    expect(readHeadlineBasis({ ...BROKEN, tiny_base_guard: v }).reasons).toEqual([]);
  });

  it("a row that is not chain-broken names no reason, whatever the guard says", () => {
    expect(readHeadlineBasis({ tiny_base_guard: true }).reasons).toEqual([]);
  });

  it("the row names a flag the worker really writes: NAV_TWR_GUARD_KEYS carries tiny_base_guard", () => {
    const raw = readFileSync(join(process.cwd(), "analytics-service", "services", "nav_twr.py"), "utf8");
    expect(raw.length).toBeGreaterThan(0);
    const tuple = /NAV_TWR_GUARD_KEYS: tuple\[str, \.\.\.\] = \(([\s\S]*?)\n\)/.exec(raw);
    expect(tuple, "NAV_TWR_GUARD_KEYS tuple must be found in nav_twr.py").not.toBeNull();
    expect(tuple![1]).toContain('"tiny_base_guard"');
  });
});

/**
 * Phase 190 plan 05 (SC-3). WHY: plan 03 admits a pending or computing row over a
 * stored success result, and every single-key inner gate must follow that ONE
 * decision. `isStoredResultReadable` is the shared test; without the flag it must
 * equal today's terminal-success test for every status, because the OG card calls
 * the gate without the flag and must keep refusing a computing row.
 */
describe("isStoredResultReadable (phase 190)", () => {
  const STATUSES = ["complete", "complete_with_warnings", "computing", "pending", "failed", null, undefined, "garbage", 7];

  it("without the flag it is exactly the terminal-success test", () => {
    for (const status of STATUSES) {
      expect(isStoredResultReadable(status, false), String(status)).toBe(
        status === "complete" || status === "complete_with_warnings",
      );
    }
  });

  it("with the flag a pending or computing status is also readable, a failed or unknown one never", () => {
    expect(isStoredResultReadable("computing", true)).toBe(true);
    expect(isStoredResultReadable("pending", true)).toBe(true);
    expect(isStoredResultReadable("complete", true)).toBe(true);
    for (const status of ["failed", null, undefined, "garbage", 7]) {
      expect(isStoredResultReadable(status, true), String(status)).toBe(false);
    }
  });
});

describe("storedCashHeadlineGate recompute argument (phase 190)", () => {
  const SEVEN = { cumulative_return: 1, volatility: 1, max_drawdown: 1, cagr: 1, sharpe: 1, sortino: 1, calmar: 1 };
  const ROW = { ...SEVEN, computation_status: "computing" };

  it("the OG card's three-argument call still refuses a computing row", () => {
    expect(storedCashHeadlineGate(ROW, null, "computing")).toEqual({ applicable: false, reason: "not_rankable" });
    expect(storedCashHeadlineGate(ROW, null, "pending")).toEqual({ applicable: false, reason: "not_rankable" });
  });

  it("with the fourth argument a computing or pending row is applicable, a failed one still is not", () => {
    expect(storedCashHeadlineGate(ROW, null, "computing", true)).toEqual({ applicable: true });
    expect(storedCashHeadlineGate(ROW, null, "pending", true)).toEqual({ applicable: true });
    expect(storedCashHeadlineGate(ROW, null, "failed", true)).toEqual({ applicable: false, reason: "not_rankable" });
  });
});

/**
 * Phase 252 DERIBITOPTIONS plan 01 (founder ruling 2026-11-25, "Withhold first, then MTM"):
 * one named, structural withhold. The trigger is strict equality on one closed string and
 * nothing else; it never reads a figure. Every oracle below is typed by hand from the
 * producer's closed set (`MTM_REASON_*` in `analytics-service/services/stitch_composite.py`),
 * never imported from the code under test, so a widened trigger fails here.
 */
describe("252 the options-book withhold", () => {
  const DATED = { twr_chain_broken: true, headline_since: "2025-12-16" };
  const OK = { applicable: true } as const;
  const OPTIONS = { composite: true, mtm_gated_reason: "unsmoothed_options_book" };

  /** The other six producer reasons: the closed oracle, hand-typed. */
  const OTHER_SIX_REASONS = [
    "mtm_basis_unavailable_for_venue",
    "mtm_summary_coverage_incomplete",
    "mtm_series_uncomputable",
    "mtm_second_pass_timeout",
    "mtm_anchor_race",
    "mtm_option_row_field_missing",
  ];

  it("pins the flag value and the cause literal the producer and the notes depend on", () => {
    expect(OPTIONS_CASH_WALLET_REASON).toBe("unsmoothed_options_book");
    expect(OPTIONS_CASH_WALLET_CAUSE).toBe("options_cash_wallet");
  });

  it("the predicate is true only for the exact string behind a plain object", () => {
    expect(isOptionsCashWalletReason("unsmoothed_options_book")).toBe(true);
    expect(isOptionsCashWalletBook(OPTIONS)).toBe(true);
    expect(isOptionsCashWalletBook({ mtm_gated_reason: "unsmoothed_options_book" })).toBe(true);
  });

  describe("precedence: it beats dated and needs neither a chain break nor an applicable gate", () => {
    const withheld = { kind: "withheld", cause: "options_cash_wallet" };

    it("beats dated (today's reading of the evidence row)", () => {
      expect(headlineVerdict({ ...DATED, composite: true, mtm_gated_reason: "unsmoothed_options_book" }, OK, "complete")).toEqual(withheld);
    });

    it("needs no chain break (today's reading of the intact-chain row is clean)", () => {
      expect(headlineVerdict(OPTIONS, OK, "complete")).toEqual(withheld);
    });

    it.each<[string, StoredCashHeadlineGate]>([
      ["applicable", { applicable: true }],
      ["no_row", { applicable: false, reason: "no_row" }],
      ["not_rankable", { applicable: false, reason: "not_rankable" }],
      ["raw_cash_settlement", { applicable: false, reason: "raw_cash_settlement" }],
      ["missing_keys", { applicable: false, reason: "missing_keys", missing: ["cagr"] }],
    ])("is independent of the gate (%s) and of the computation status", (_n, gate) => {
      for (const status of ["complete", "computing", "pending", "failed", undefined, null, "archived"]) {
        expect(headlineVerdict(OPTIONS, gate, status)).toEqual(withheld);
        expect(headlineVerdict({ ...DATED, ...OPTIONS }, gate, status)).toEqual(withheld);
      }
    });
  });

  describe("NOT_TRIGGERS: each reads exactly as the same flags with mtm_gated_reason removed", () => {
    const BASES: Array<[string, Record<string, unknown>, unknown]> = [
      ["an intact composite", { composite: true }, { kind: "clean" }],
      ["a dated chain-broken composite", { composite: true, ...DATED }, { kind: "dated", since: "2025-12-16" }],
      ["an undated chain-broken composite", { composite: true, twr_chain_broken: true }, { kind: "withheld", cause: "unmeasured" }],
    ];
    const VALUES: Array<[string, unknown]> = [
      ...OTHER_SIX_REASONS.map((r): [string, unknown] => [r, r]),
      ["a case variant", "UNSMOOTHED_OPTIONS_BOOK"],
      ["a mixed case variant", "Unsmoothed_Options_Book"],
      ["a leading-space variant", " unsmoothed_options_book"],
      ["a trailing-space variant", "unsmoothed_options_book "],
      ["a prefix of the reason", "unsmoothed_options"],
      ["the reason with a suffix", "unsmoothed_options_book_v2"],
      ["boolean true", true],
      ["an array holding the reason", ["unsmoothed_options_book"]],
      ["an object holding the reason", { reason: "unsmoothed_options_book" }],
      ["null", null],
      ["the empty string", ""],
      ["a number", 1],
    ];

    for (const [baseName, base, expected] of BASES) {
      it.each(VALUES)(`${baseName} with mtm_gated_reason = %s`, (_n, value) => {
        const without = headlineVerdict(base, OK, "complete");
        expect(without, "the hand-typed oracle for the base").toEqual(expected);
        expect(headlineVerdict({ ...base, mtm_gated_reason: value }, OK, "complete")).toEqual(without);
        expect(isOptionsCashWalletBook({ ...base, mtm_gated_reason: value })).toBe(false);
      });
    }

    it.each<[string, unknown]>([
      ["undefined", undefined],
      ["null", null],
      ["a string", "unsmoothed_options_book"],
      ["a number", 42],
      ["an array", ["unsmoothed_options_book"]],
      ["an array carrying the key", Object.assign([], { mtm_gated_reason: "unsmoothed_options_book" })],
    ])("a non-object data_quality_flags (%s) is clean and not the book", (_n, dqf) => {
      expect(isOptionsCashWalletBook(dqf)).toBe(false);
      expect(headlineVerdict(dqf, OK, "complete")).toEqual({ kind: "clean" });
    });
  });

  describe("MT5 shapes: the verdict, the applier and the card equal the same shape without the key", () => {
    const SEVEN = { cumulative_return: 0.4, volatility: 0.12, max_drawdown: -0.1, cagr: 0.6, sharpe: 1.5, sortino: 2.1, calmar: 3 };
    const HEADLINE = { ...SEVEN };
    const DAY = 86_400_000;
    const SERIES = Array.from({ length: 400 }, (_, i) => ({
      date: new Date(Date.parse("2023-01-01") + i * DAY).toISOString().slice(0, 10),
      value: i % 2 === 0 ? 0.002 : -0.001,
    }));
    const card = (dqf: Record<string, unknown>) =>
      computeOgHeadline(SERIES, "crypto", { ...SEVEN, computation_status: "complete", metrics_json_by_basis: null, data_quality_flags: dqf });

    it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
      ["a native-unit MT5 account with no reason", { native_unit: "USD" }, { native_unit: "USD" }],
      [
        "an MT5 composite whose reason is the venue reason",
        { composite: true, mtm_gated_reason: "mtm_basis_unavailable_for_venue" },
        { composite: true },
      ],
    ])("%s", (_n, dqf, withoutKey) => {
      expect(headlineVerdict(dqf, OK, "complete")).toEqual({ kind: "clean" });
      expect(headlineVerdict(dqf, OK, "complete")).toEqual(headlineVerdict(withoutKey, OK, "complete"));
      // The applier: the headline comes back untouched and the quality object is empty.
      const applied = applyHeadlineBasis(HEADLINE, dqf, { composite: true });
      expect(applied).toEqual({ headline: SEVEN, redacted: false, quality: {} });
      expect(applied).toEqual(applyHeadlineBasis(HEADLINE, withoutKey, { composite: true }));
      // The card: the stored figures print, with and without the key.
      expect(card(dqf)).toEqual({ sharpe: 1.5, cagr: 0.6, maxDd: -0.1 });
      expect(card(dqf)).toEqual(card(withoutKey));
    });
  });

  describe("the public sentences", () => {
    const FORBIDDEN = ["mtm_gated_reason", "unsmoothed", "flag", "chain", "job"];

    it("pins the four sentences verbatim (typed by hand) and none names a flag, a job or a chain break", () => {
      const expected = {
        headline:
          "Headline figures withheld: this strategy trades options, and its returns are measured on the cash wallet, which leaves out the market value of open option positions.",
        panel:
          "Withheld: this panel is measured on the cash wallet, which leaves out the market value of open option positions.",
        range:
          "Figures for this range are withheld: the record is measured on the cash wallet, which leaves out the market value of open option positions.",
        card: "Figures withheld: measured on the cash wallet, which leaves out open option positions.",
      };
      expect(OPTIONS_CASH_WALLET_PHRASES).toEqual(expected);
      for (const [slot, text] of Object.entries(OPTIONS_CASH_WALLET_PHRASES)) {
        for (const token of FORBIDDEN) {
          expect(text.toLowerCase(), `${slot} must not contain "${token}"`).not.toContain(token);
        }
      }
    });
  });
});
