/**
 * Phase 256 plan 08 (D-05, SC-3, T-256-23, T-256-24) - the list projection names an OKX unit switch
 * from THREE closed scalars of `data_quality_flags.unit_switch`, and nothing wider.
 *
 * WHY each arm matters: the list is the one public surface where the flags blob must never cross
 * (RANK-02), and a switch sentence with a guessed day would be a false claim about a record. So the
 * select carries exactly six `->>` text scalars (three live, three from the derive hop's snapshot),
 * and `shapeRowAnalytics` keeps the three only when they pass `parseUnitSwitch` TOGETHER: a missing
 * or malformed scalar yields no switch at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const recorders = vi.hoisted(() => ({
  strategySelectCols: [] as string[],
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
const fakeClient = () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        recorders.strategySelectCols.push(cols);
        return chain;
      };
      for (const m of ["eq", "in", "order", "limit", "neq", "not", "is", "gte", "lte", "range", "or"]) {
        chain[m] = () => chain;
      }
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onFulfilled);
      return chain;
    },
    rpc: async () => ({ data: [], error: null }),
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeClient() }));

import { CATEGORY_RANKING_ANALYTICS_COLUMNS, getStrategiesByCategory, shapeRowAnalytics } from "./queries";
import type { StrategyAnalytics } from "./types";

const SID = "5a000000-0000-4000-8000-000000000256";
const SNAPSHOT_AT = "2026-11-20T10:00:00.123Z";

const SWITCH = { coin: "BTC", last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-15" };

function base(over: Record<string, unknown>): StrategyAnalytics {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000256",
    strategy_id: SID,
    computed_at: SNAPSHOT_AT,
    computation_status: "complete",
    cumulative_return: 0.12,
    cagr: 0.05,
    sharpe: 0.6,
    series_end: "2026-11-19",
    data_quality_flags: null,
    ...over,
  } as unknown as StrategyAnalytics;
}

const shape = (a: StrategyAnalytics) => shapeRowAnalytics(a, SID);

/** Every `data_quality_flags...` reference in a select string, each up to the next comma. */
function flagRefs(select: string): string[] {
  return select.match(/data_quality_flags[^,]*/g) ?? [];
}

const SIX_SCALARS = [
  "unit_switch_coin:data_quality_flags->unit_switch->>coin",
  "unit_switch_last_usd_day:data_quality_flags->unit_switch->>last_usd_day",
  "unit_switch_first_coin_day:data_quality_flags->unit_switch->>first_coin_return_day",
  "last_success_unit_switch_coin:data_quality_flags->last_success_snapshot->flags->unit_switch->>coin",
  "last_success_unit_switch_last_usd_day:data_quality_flags->last_success_snapshot->flags->unit_switch->>last_usd_day",
  "last_success_unit_switch_first_coin_day:data_quality_flags->last_success_snapshot->flags->unit_switch->>first_coin_return_day",
];

describe("the ranked list select carries the unit switch as six closed scalars (T-256-23)", () => {
  it("each of the six aliases is in the select exactly once", () => {
    for (const alias of SIX_SCALARS) {
      expect(CATEGORY_RANKING_ANALYTICS_COLUMNS.split(alias).length - 1, alias).toBe(1);
    }
  });

  it("the select reaches getStrategiesByCategory's embed (the one anonymous list read)", async () => {
    recorders.strategySelectCols = [];
    await getStrategiesByCategory("crypto-sma");
    const cols = recorders.strategySelectCols.at(-1) ?? "";
    for (const alias of SIX_SCALARS) expect(cols, alias).toContain(alias);
  });

  it("every unit_switch reference is a `->>` text scalar of one of the three closed fields, never the object", () => {
    const refs = flagRefs(CATEGORY_RANKING_ANALYTICS_COLUMNS).filter((r) => r.includes("unit_switch"));
    expect(refs).toHaveLength(6);
    for (const r of refs) {
      expect(r).toMatch(
        /^data_quality_flags->(?:last_success_snapshot->flags->)?unit_switch->>(?:coin|last_usd_day|first_coin_return_day)$/,
      );
    }
  });

  it("the closed-form check refuses a widened read (the object, another field, or the bare snapshot)", () => {
    const ALLOWED =
      /^data_quality_flags->(?:last_success_snapshot->flags->)?unit_switch->>(?:coin|last_usd_day|first_coin_return_day)$/;
    for (const bad of [
      "data_quality_flags->unit_switch",
      "data_quality_flags->unit_switch->>switch_day",
      "data_quality_flags->>unit_switch",
      "data_quality_flags->last_success_snapshot->flags->unit_switch",
      "data_quality_flags->last_success_snapshot->flags",
    ]) {
      expect(ALLOWED.test(bad), bad).toBe(false);
    }
  });
});

describe("shapeRowAnalytics - a switched row carries the three parsed scalars (SC-3)", () => {
  it("an anonymous ranked row: the projected aliases become the three scalars, the aliases are gone", () => {
    const out = shape(
      base({
        unit_switch_coin: "BTC",
        unit_switch_last_usd_day: "2026-11-14",
        unit_switch_first_coin_day: "2026-11-15",
        last_success_unit_switch_coin: "ETH",
      }),
    );
    expect(out.unit_switch_coin).toBe("BTC");
    expect(out.unit_switch_last_usd_day).toBe("2026-11-14");
    expect(out.unit_switch_first_coin_day).toBe("2026-11-15");
    expect("last_success_unit_switch_coin" in out).toBe(false);
  });

  it("an owner wildcard row: the three are read out of the unit_switch object of the flags blob", () => {
    const out = shape(base({ data_quality_flags: { unit_switch: SWITCH } }));
    expect(out.unit_switch_coin).toBe("BTC");
    expect(out.unit_switch_last_usd_day).toBe("2026-11-14");
    expect(out.unit_switch_first_coin_day).toBe("2026-11-15");
  });

  it("a switched row still reads as a USD row: no native unit is derived from the switch", () => {
    const out = shape(base({ data_quality_flags: { unit_switch: SWITCH } }));
    expect(out.unit_switch_coin).toBe("BTC");
    expect(out.native_unit ?? null).toBeNull();
  });

  it("a USD row carries none of the keys (its shaped object is unchanged)", () => {
    const out = shape(base({ data_quality_flags: { cumulative_method: "geometric" } }));
    expect("unit_switch_coin" in out).toBe(false);
    expect("unit_switch_last_usd_day" in out).toBe(false);
    expect("unit_switch_first_coin_day" in out).toBe(false);
  });

  it.each([
    ["no coin", { last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-15" }],
    ["no last day", { coin: "BTC", first_coin_return_day: "2026-11-15" }],
    ["no first day", { coin: "BTC", last_usd_day: "2026-11-14" }],
    ["a lower-case coin", { ...SWITCH, coin: "btc" }],
    ["USD as the coin", { ...SWITCH, coin: "USD" }],
    ["markup as the coin", { ...SWITCH, coin: "<b>X</b>" }],
    ["a day that is not a day", { ...SWITCH, last_usd_day: "2026-02-30" }],
    ["days two apart", { ...SWITCH, first_coin_return_day: "2026-11-16" }],
    ["a non-string day", { ...SWITCH, last_usd_day: 20261114 }],
  ])("%s: no scalar at all, never a partial or guessed switch", (_label, flag) => {
    const out = shape(base({ data_quality_flags: { unit_switch: flag } }));
    expect("unit_switch_coin" in out).toBe(false);
    expect("unit_switch_last_usd_day" in out).toBe(false);
    expect("unit_switch_first_coin_day" in out).toBe(false);
  });

  it("one malformed alias among three voids the switch (the three parse together)", () => {
    const out = shape(
      base({
        unit_switch_coin: "BTC",
        unit_switch_last_usd_day: "garbage",
        unit_switch_first_coin_day: "2026-11-15",
      }),
    );
    expect("unit_switch_coin" in out).toBe(false);
  });

  it("a non-rankable row (failed) is blanked and shows no switch", () => {
    const out = shape(
      base({ computation_status: "failed", data_quality_flags: { unit_switch: SWITCH } }),
    );
    expect(out.unit_switch_coin ?? null).toBeNull();
  });
});

describe("shapeRowAnalytics - the switch follows the SAME flags generation as the figures (a held re-run)", () => {
  const PRESTAMPED = {
    computation_status: "computing",
    cumulative_method: null,
    native_unit: null,
    unit_switch_coin: null,
    unit_switch_last_usd_day: null,
    unit_switch_first_coin_day: null,
    last_success_cumulative_method: "geometric",
    last_success_computed_at: SNAPSHOT_AT,
    last_success_unit_switch_coin: "BTC",
    last_success_unit_switch_last_usd_day: "2026-11-14",
    last_success_unit_switch_first_coin_day: "2026-11-15",
    computed_at: "2026-11-20T10:00:00.123Z",
  };

  it("an alias row past the derive prestamp takes the SNAPSHOT's switch", () => {
    const out = shape(base(PRESTAMPED));
    expect(out.analytics_updating).toBe(true);
    expect(out.unit_switch_coin).toBe("BTC");
    expect(out.unit_switch_last_usd_day).toBe("2026-11-14");
    expect(out.unit_switch_first_coin_day).toBe("2026-11-15");
    expect("last_success_unit_switch_coin" in out).toBe(false);
  });

  it("a blob row past the prestamp takes the snapshot flags' unit_switch object", () => {
    const out = shape(
      base({
        computation_status: "computing",
        data_quality_flags: {
          last_success_snapshot: {
            computed_at: SNAPSHOT_AT,
            flags: { cumulative_method: "geometric", unit_switch: SWITCH },
          },
        },
      }),
    );
    expect(out.analytics_updating).toBe(true);
    expect(out.unit_switch_coin).toBe("BTC");
  });
});

beforeEach(() => {
  recorders.strategySelectCols = [];
});
