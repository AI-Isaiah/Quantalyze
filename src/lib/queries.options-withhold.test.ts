import { describe, it, expect, vi } from "vitest";

/**
 * Phase 252 plan 04 - the list-side options-book withhold.
 *
 * WHY THIS FILE EXISTS. A strategy whose stored figures are measured on the cash wallet (the
 * composite carries `mtm_gated_reason: "unsmoothed_options_book"`) must not show a CAGR, Sharpe,
 * cumulative return, sparkline or record span in Discovery, on the owner lists or in a percentile
 * rank, because the cash wallet leaves out the market value of open option positions and the number
 * would read as a verified track record. `shapeRowAnalytics` is the one shaper behind all of those
 * lists, so the withhold lives there, judged on the SAME flags generation as the figures the row
 * would otherwise show (a derive prestamp replaces the live flags and drops the reason with them).
 *
 * The sentences are typed by hand: copying them from the source would make the pin agree with
 * whatever the source says.
 */

const state = vi.hoisted(() => ({
  queryResult: { data: null as unknown, error: null as unknown },
  lastSelect: "",
}));

function builder() {
  const chain: Record<string, unknown> = {};
  chain.select = (columns: string) => {
    state.lastSelect = columns;
    return chain;
  };
  chain.eq = () => chain;
  chain.neq = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(state.queryResult).then(resolve);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => builder() }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => builder() }),
}));

import { getOwnCapitalStrategies, getOwnRowPercentiles, getPercentiles, shapeRowAnalytics } from "./queries";
import { EMPTY_ANALYTICS } from "./utils";
import { gateAnnualized, withheldCellTitle } from "./figure-gate";
import { rowRecord } from "@/components/strategy/annualized-cell";
import type { StrategyAnalytics } from "./types";

const REASON = "unsmoothed_options_book";
const COMPUTED_AT = "2026-11-20T10:00:00+00:00";
const OTHER_COMPUTED_AT = "2026-11-10T10:00:00+00:00";
const FETCHED = "2026-11-24T04:00:00+00:00";

/** An anon ranked-read row: the alias projection, no flags blob. */
const aliasRow = (over: Partial<StrategyAnalytics> = {}): StrategyAnalytics => ({
  ...EMPTY_ANALYTICS,
  id: "an-1",
  strategy_id: "s-1",
  computed_at: COMPUTED_AT,
  computation_status: "complete",
  cumulative_return: 0.42,
  cagr: 0.31,
  sharpe: 1.8,
  volatility: 0.2,
  max_drawdown: -0.1,
  sparkline_returns: [0.01, 0.02],
  series_start: "2025-01-01",
  series_end: "2026-11-19",
  record_observations: 322,
  trades_fetched_at: FETCHED,
  cumulative_method: "geometric",
  mtm_gated_reason: REASON,
  ...over,
});

const BLANK_MARKED = (status: string): StrategyAnalytics => ({
  ...EMPTY_ANALYTICS,
  strategy_id: "s-1",
  computation_status: status as StrategyAnalytics["computation_status"],
  trades_fetched_at: FETCHED,
  headline_withheld_cause: "options_cash_wallet",
});

describe("252 shapeRowAnalytics - an options book leaves the list blank and marked", () => {
  it("an anon ranked row (aliases only), complete, is the blank shape plus the named marker", () => {
    const shaped = shapeRowAnalytics(aliasRow(), "s-1");
    expect(shaped).toEqual(BLANK_MARKED("complete"));
    // The figures a reader would see are all gone, and so is the record span.
    expect(shaped.cagr).toBeNull();
    expect(shaped.sharpe).toBeNull();
    expect(shaped.cumulative_return).toBeNull();
    expect(shaped.sparkline_returns).toBeNull();
    expect(shaped.series_start).toBeUndefined();
    expect(shaped.series_end).toBeNull();
    // The real status and the trade-fetch time are kept: the row still shows its sync line.
    expect(shaped.computation_status).toBe("complete");
    expect(shaped.trades_fetched_at).toBe(FETCHED);
    // Neither alias input leaves the shaper.
    expect("mtm_gated_reason" in shaped).toBe(false);
    expect("last_success_mtm_gated_reason" in shaped).toBe(false);
  });

  it("the withhold does not depend on the status: a failed flagged row is blank, marked and keeps its failed status", () => {
    expect(shapeRowAnalytics(aliasRow({ computation_status: "failed" }), "s-1")).toEqual(
      BLANK_MARKED("failed"),
    );
  });

  it("a row held over a stored success (live alias gone with the prestamp, snapshot bound to computed_at) is still blank and marked", () => {
    const held = aliasRow({
      computation_status: "computing",
      cumulative_method: null,
      mtm_gated_reason: null,
      last_success_cumulative_method: "geometric",
      last_success_computed_at: COMPUTED_AT,
      last_success_mtm_gated_reason: REASON,
    });
    const shaped = shapeRowAnalytics(held, "s-1");
    expect(shaped).toEqual(BLANK_MARKED("computing"));
    expect("analytics_updating" in shaped).toBe(false);
  });

  it("a held row whose snapshot does NOT carry the reason is not withheld, even when the raw live alias still does (the live flags of a held row are never read)", () => {
    const held = aliasRow({
      computation_status: "computing",
      cumulative_method: null,
      mtm_gated_reason: REASON,
      last_success_cumulative_method: "geometric",
      last_success_computed_at: COMPUTED_AT,
      last_success_mtm_gated_reason: null,
    });
    const shaped = shapeRowAnalytics(held, "s-1");
    expect(shaped.headline_withheld_cause).toBeUndefined();
    expect(shaped.analytics_updating).toBe(true);
    expect(shaped.cagr).toBe(0.31);
  });

  it("a snapshot bound to ANOTHER success never counts: the live generation stands and a complete unflagged row keeps its figures", () => {
    const shaped = shapeRowAnalytics(
      aliasRow({
        mtm_gated_reason: null,
        last_success_cumulative_method: "geometric",
        last_success_computed_at: OTHER_COMPUTED_AT,
        last_success_mtm_gated_reason: REASON,
      }),
      "s-1",
    );
    expect(shaped.headline_withheld_cause).toBeUndefined();
    expect(shaped.cagr).toBe(0.31);
  });

  it("an owner wildcard row (flags blob carrying the reason) is blank and marked", () => {
    const shaped = shapeRowAnalytics(
      aliasRow({
        cumulative_method: undefined,
        mtm_gated_reason: undefined,
        data_quality_flags: { cumulative_method: "geometric", mtm_gated_reason: REASON } as never,
      }),
      "s-1",
    );
    expect(shaped).toEqual(BLANK_MARKED("complete"));
  });

  it("an owner wildcard row held over a bound snapshot that carries the reason is blank and marked", () => {
    const shaped = shapeRowAnalytics(
      aliasRow({
        computation_status: "computing",
        cumulative_method: undefined,
        mtm_gated_reason: undefined,
        data_quality_flags: {
          last_success_snapshot: {
            computed_at: COMPUTED_AT,
            flags: { cumulative_method: "geometric", mtm_gated_reason: REASON },
          },
        } as never,
      }),
      "s-1",
    );
    expect(shaped).toEqual(BLANK_MARKED("computing"));
  });
});

describe("252 NOT_TRIGGERS - every other row is shaped exactly as before", () => {
  const NOT_TRIGGERS: Array<[string, string | null | undefined]> = [
    ["another reason (no cash basis for the venue)", "mtm_basis_unavailable_for_venue"],
    ["another reason (coverage incomplete)", "mtm_summary_coverage_incomplete"],
    ["a case variant", "Unsmoothed_Options_Book"],
    ["a padded string", " unsmoothed_options_book"],
    ["an empty string", ""],
    ["null", null],
    ["absent", undefined],
  ];

  it.each(NOT_TRIGGERS)(
    "an alias row whose reason is %s is shaped byte-identically to the same row without the alias keys",
    (_label, reason) => {
      const withAlias = aliasRow({ mtm_gated_reason: reason, last_success_mtm_gated_reason: reason });
      const withoutAlias = aliasRow();
      delete withoutAlias.mtm_gated_reason;
      delete withoutAlias.last_success_mtm_gated_reason;
      const shaped = shapeRowAnalytics(withAlias, "s-1");
      expect(shaped).toEqual(shapeRowAnalytics(withoutAlias, "s-1"));
      expect("headline_withheld_cause" in shaped).toBe(false);
      expect("mtm_gated_reason" in shaped).toBe(false);
      expect("last_success_mtm_gated_reason" in shaped).toBe(false);
      // Anti-vacuity: the figures really did pass through, so the equality is not two blanks.
      expect(shaped.cagr).toBe(0.31);
      expect(shaped.sharpe).toBe(1.8);
    },
  );

  it("an MT5-shaped row (no reason anywhere) carries neither the marker nor either alias key, and its figures pass through", () => {
    const mt5 = aliasRow();
    delete mt5.mtm_gated_reason;
    const shaped = shapeRowAnalytics(mt5, "s-mt5");
    expect(shaped.cagr).toBe(0.31);
    expect(shaped.series_start).toBe("2025-01-01");
    expect(Object.keys(shaped)).not.toContain("headline_withheld_cause");
    expect(Object.keys(shaped)).not.toContain("mtm_gated_reason");
    expect(Object.keys(shaped)).not.toContain("last_success_mtm_gated_reason");
  });

  it("the trigger and a non-trigger are different outputs (the table is not comparing two blanks)", () => {
    expect(shapeRowAnalytics(aliasRow(), "s-1")).not.toEqual(
      shapeRowAnalytics(aliasRow({ mtm_gated_reason: "mtm_basis_unavailable_for_venue" }), "s-1"),
    );
  });
});

describe("252 rowRecord - the marker becomes the record's named withhold", () => {
  const SENTENCE = "Withheld: measured on the cash wallet, which leaves out open option positions.";

  it("a blanked, marked row carries withheldBy, the gate withholds, and the cell sentence is the hand-typed one", () => {
    const record = rowRecord({
      asset_class: "crypto",
      analytics: shapeRowAnalytics(aliasRow(), "s-1"),
    });
    expect(record.withheldBy).toBe("options_cash_wallet");
    expect(gateAnnualized(record)).toBe("withheld");
    expect(withheldCellTitle(record)).toBe(SENTENCE);
  });

  it("an unmarked row's record has no withheldBy key at all (byte-identical to today)", () => {
    const record = rowRecord({
      asset_class: "crypto",
      analytics: shapeRowAnalytics(aliasRow({ mtm_gated_reason: null }), "s-1"),
    });
    expect("withheldBy" in record).toBe(false);
    // Anti-vacuity: the same span and count clear the gate, so the withhold above is the marker's doing.
    expect(gateAnnualized(record)).not.toBe("withheld");
  });
});


/* ------------------------------------------------------------------------------------------------
 * Task 2 - the percentile readers drop a flagged row from every peer set
 * ---------------------------------------------------------------------------------------------- */

describe("252 getPercentiles - a flagged row neither receives a rank nor adds a value to anyone's population", () => {
  const kpis = (sharpe: number) => ({
    computation_status: "complete",
    sharpe,
    cagr: sharpe / 10,
    sortino: sharpe,
    calmar: sharpe,
    volatility: 0.1 * sharpe,
    max_drawdown: -0.1,
    cumulative_return: 0.1 * sharpe,
  });
  const LONG = {
    series_start: "2025-01-01",
    series_end: "2026-03-02",
    headline_since: null,
    record_observations: 300,
  };
  const published = (id: string, sharpe: number, extra: Record<string, unknown> = {}) => ({
    id,
    asset_class: "crypto",
    strategy_analytics: { ...kpis(sharpe), ...LONG, ...extra },
  });
  const FIVE = ["A", "B", "C", "D", "E"].map((id, i) => published(id, i + 1));

  it("five published rows plus one flagged row with the best figures: the flagged row has no entry, and no other row's rank moves", async () => {
    state.queryResult = { data: FIVE, error: null };
    const without = (await getPercentiles())!;
    state.queryResult = {
      data: [
        ...FIVE,
        published("F", 99, { cumulative_method: "geometric", mtm_gated_reason: REASON }),
      ],
      error: null,
    };
    const withFlagged = (await getPercentiles())!;
    expect(withFlagged.F).toBeUndefined();
    expect(withFlagged).toEqual(without);
    // Anti-vacuity: the population did rank the five.
    expect(withFlagged.E.sharpe).toBeDefined();
  });

  it("control: the same sixth row WITHOUT the reason ranks, at the top", async () => {
    state.queryResult = {
      data: [...FIVE, published("F", 99, { cumulative_method: "geometric", mtm_gated_reason: null })],
      error: null,
    };
    const map = (await getPercentiles())!;
    expect(map.F).toBeDefined();
    expect(map.F.sharpe).toBeGreaterThanOrEqual(map.E.sharpe as number);
  });

  it("a case variant of the reason is not the reason: the row ranks (strict equality)", async () => {
    state.queryResult = {
      data: [...FIVE, published("F", 99, { mtm_gated_reason: "Unsmoothed_Options_Book" })],
      error: null,
    };
    expect((await getPercentiles())!.F).toBeDefined();
  });

  it("W5 held generation: a terminal row whose live alias lacks the marker and the reason, with a snapshot BOUND to computed_at that carries the reason, is skipped", async () => {
    state.queryResult = {
      data: [
        ...FIVE,
        published("F", 99, {
          computed_at: COMPUTED_AT,
          cumulative_method: null,
          mtm_gated_reason: null,
          last_success_cumulative_method: "geometric",
          last_success_computed_at: COMPUTED_AT,
          last_success_mtm_gated_reason: REASON,
        }),
      ],
      error: null,
    };
    expect((await getPercentiles())!.F).toBeUndefined();
  });

  it("W5 held generation: the same snapshot bound to ANOTHER success never counts, so the row ranks (the live generation stands)", async () => {
    state.queryResult = {
      data: [
        ...FIVE,
        published("F", 99, {
          computed_at: COMPUTED_AT,
          cumulative_method: null,
          mtm_gated_reason: null,
          last_success_cumulative_method: "geometric",
          last_success_computed_at: OTHER_COMPUTED_AT,
          last_success_mtm_gated_reason: REASON,
        }),
      ],
      error: null,
    };
    expect((await getPercentiles())!.F).toBeDefined();
  });
});

describe("252 getOwnRowPercentiles - the population skip and the subject filter", () => {
  const kpis = (sharpe: number) => ({
    computation_status: "complete",
    sharpe,
    cagr: sharpe / 10,
    sortino: sharpe,
    calmar: sharpe,
    volatility: 0.1 * sharpe,
    max_drawdown: -0.1,
    cumulative_return: 0.1 * sharpe,
  });
  const LONG = {
    series_start: "2025-01-01",
    series_end: "2026-03-02",
    headline_since: null,
    record_observations: 300,
  };
  const published = (id: string, sharpe: number, extra: Record<string, unknown> = {}) => ({
    id,
    asset_class: "crypto",
    strategy_analytics: { ...kpis(sharpe), ...LONG, ...extra },
  });
  const FIVE = ["A", "B", "C", "D", "E"].map((id, i) => published(id, i + 1));
  const ownRow = (id: string, sharpe: number, flagged: boolean): {
    id: string;
    analytics: StrategyAnalytics;
    asset_class: string;
  } => ({
    id,
    asset_class: "crypto",
    analytics: shapeRowAnalytics(
      {
        ...EMPTY_ANALYTICS,
        id: `an-${id}`,
        strategy_id: id,
        computed_at: COMPUTED_AT,
        ...kpis(sharpe),
        ...LONG,
        cumulative_method: "geometric",
        mtm_gated_reason: flagged ? REASON : null,
      } as unknown as StrategyAnalytics,
      id,
    ),
  });

  it("a flagged PUBLISHED row is skipped from the population: it has no published entry and moves nobody's rank", async () => {
    state.queryResult = { data: FIVE, error: null };
    const base = (await getOwnRowPercentiles([ownRow("own", 3.5, false)]))!;
    state.queryResult = {
      data: [...FIVE, published("F", 99, { cumulative_method: "geometric", mtm_gated_reason: REASON })],
      error: null,
    };
    const withFlagged = (await getOwnRowPercentiles([ownRow("own", 3.5, false)]))!;
    expect(withFlagged.publishedMap.F).toBeUndefined();
    expect(withFlagged.publishedMap).toEqual(base.publishedMap);
    expect(withFlagged.ownMap).toEqual(base.ownMap);
    expect(withFlagged.populationSize).toBe(base.populationSize);
    // Anti-vacuity: the unflagged own row did receive a rank.
    expect(withFlagged.ownMap.own).toBeDefined();
  });

  it("a flagged OWN row (shaped analytics carrying the marker) receives no percentile, published or not; an unflagged own row does", async () => {
    state.queryResult = { data: FIVE, error: null };
    const result = (await getOwnRowPercentiles([
      ownRow("own-flagged", 3.5, true),
      ownRow("own-ok", 3.5, false),
    ]))!;
    expect(result.ownMap["own-flagged"]).toBeUndefined();
    expect(result.ownMap["own-ok"]).toBeDefined();
  });

  it("the subject filter stands on its own: a subject carrying the marker AND figures (a state the shaper never emits) still gets no entry", async () => {
    // The shaper blanks a flagged row's KPIs, so a shaped subject cannot be ranked anyway. This pins
    // the filter itself, so it cannot be deleted as redundant while the blanking is the only guard.
    state.queryResult = { data: FIVE, error: null };
    const figured = ownRow("own-figured", 3.5, false);
    figured.analytics = { ...figured.analytics, headline_withheld_cause: "options_cash_wallet" };
    const result = (await getOwnRowPercentiles([figured, ownRow("own-ok", 3.5, false)]))!;
    expect(result.ownMap["own-figured"]).toBeUndefined();
    expect(result.ownMap["own-ok"]).toBeDefined();
  });

  it("a flagged own row that is ALSO published gets no entry in either map", async () => {
    state.queryResult = {
      data: [...FIVE, published("own-flagged", 3.5, { cumulative_method: "geometric", mtm_gated_reason: REASON })],
      error: null,
    };
    const result = (await getOwnRowPercentiles([ownRow("own-flagged", 3.5, true)]))!;
    expect(result.ownMap["own-flagged"]).toBeUndefined();
    expect(result.publishedMap["own-flagged"]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------------------------------
 * Task 2 - getOwnCapitalStrategies carries the marker (named W5 decision: the live flags)
 * ---------------------------------------------------------------------------------------------- */

describe("252 getOwnCapitalStrategies - figure_withheld_by on the Holdings marked half", () => {
  const row = (flags: unknown) => ({
    id: "s-1",
    name: "Helios Basis",
    codename: null,
    disclosure_tier: "exploratory",
    status: "private",
    capital_ownership: "own_capital",
    asset_class: "crypto",
    strategy_analytics: {
      daily_returns: [
        { date: "2026-01-01", value: 0.001 },
        { date: "2026-03-02", value: 0.002 },
      ],
      cagr: 0.4,
      sharpe: 1.8,
      volatility: 0.3,
      max_drawdown: -0.12,
      returns_series: null,
      data_quality_flags: flags,
      computed_at: COMPUTED_AT,
      record_observations: undefined,
    },
  });
  const read = async (flags: unknown) => {
    state.queryResult = { data: [row(flags)], error: null };
    const out = await getOwnCapitalStrategies("00000000-0000-4000-8000-0000000000bb");
    expect(out).not.toBeNull();
    return out![0];
  };

  it("live flags carrying the reason mark the row; another reason, a case variant, and no flags do not", async () => {
    expect((await read({ cumulative_method: "geometric", mtm_gated_reason: REASON })).figure_withheld_by).toBe(
      "options_cash_wallet",
    );
    expect((await read({ mtm_gated_reason: REASON })).figure_withheld_by).toBe("options_cash_wallet");
    expect((await read({ mtm_gated_reason: "mtm_basis_unavailable_for_venue" })).figure_withheld_by).toBeNull();
    expect((await read({ mtm_gated_reason: "UNSMOOTHED_OPTIONS_BOOK" })).figure_withheld_by).toBeNull();
    expect((await read({ cumulative_method: "geometric" })).figure_withheld_by).toBeNull();
    expect((await read(null)).figure_withheld_by).toBeNull();
  });

  it("a held row (live flags lack the reason, a snapshot BOUND to computed_at carries it) is marked; a snapshot bound to ANOTHER success is not (SFH-HIGH-1)", async () => {
    const snapshot = (computedAt: string) => ({
      last_success_snapshot: {
        computed_at: computedAt,
        flags: { cumulative_method: "geometric", mtm_gated_reason: REASON },
      },
    });
    expect((await read(snapshot(COMPUTED_AT))).figure_withheld_by).toBe("options_cash_wallet");
    // The mock returns whatever it is handed, so pin the projection itself: without `computed_at`
    // in the select a bound snapshot could never apply against the real read.
    expect(state.lastSelect).toMatch(/\bcomputed_at\b/);
    expect((await read(snapshot(OTHER_COMPUTED_AT))).figure_withheld_by).toBeNull();
  });

  it("the flags blob and the reason never ride the payload (the field is the whole disclosure)", async () => {
    const out = await read({ cumulative_method: "geometric", mtm_gated_reason: REASON });
    const analytics = out.strategy_analytics as Record<string, unknown>;
    expect("data_quality_flags" in analytics).toBe(false);
    expect("mtm_gated_reason" in analytics).toBe(false);
    // `computed_at` is selected only to bind the snapshot; it is stripped so the shape is unchanged.
    expect("computed_at" in analytics).toBe(false);
  });
});
