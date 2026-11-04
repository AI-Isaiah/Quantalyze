/**
 * Phase 188 (TINYBASE) plan 09, D-07, T-KL1-SCOPE, SC-3, SC-5: every per-key unit the compare
 * panel builds carries the days the tiny-base rule left out of that key's stored series, so the
 * engine sits the key out of them (the mirror of the compose's dropped days) instead of reading
 * them as a flat 0% day. The live-book column and a saved draft over the same keys read the same
 * series, and the live-book column agrees with the SSR live baseline.
 *
 * Fixture (synthetic keys, typed beside the sums): 2026-03-01..2026-03-12. `key-a` has a return
 * every day. `key-b` has none on 2026-03-07 and 2026-03-08 (the days it names). Equity 10000 and
 * 30000 normalise to weights 0.25 / 0.75. On a shared day the blend is (rA + 3 rB) / 4; on a
 * named day it is `key-a` alone: 0.02 on 2026-03-07 and -0.01 on 2026-03-08. A saved draft at
 * weights 0.5 / 0.5 reads the same two days as `key-a` alone; the old arithmetic read
 * (0.02 + 0) / 2 = 0.01 there.
 */
import { describe, it, expect, vi } from "vitest";

// `queries.ts` pulls server-only modules; the baseline builder under test is a pure function.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
import type { DailyPoint } from "@/lib/scenario";
import { liveBaselineMetricsFromPerKeyDailies } from "@/lib/queries";
import type { ScenarioDraft } from "./scenario-state";
import { buildPerKeyStrategyForBuilderSet } from "./scenario-adapter";
import {
  buildLiveBookDraft,
  computeMetricsForDraft,
  type ScenarioCompareInputs,
} from "./scenario-compare";

const DAYS = Array.from({ length: 12 }, (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`);
const NAMED = ["2026-03-07", "2026-03-08"];
const A = [0.01, -0.005, 0.02, 0.0, 0.015, -0.01, 0.02, -0.01, 0.005, 0.01, -0.02, 0.012];
const B_DAYS = DAYS.filter((d) => !NAMED.includes(d));
const B = [0.03, -0.02, 0.01, 0.005, -0.015, 0.025, 0.02, -0.01, 0.015, -0.005];

const aSeries: DailyPoint[] = DAYS.map((date, i) => ({ date, value: A[i] }));
const bSeries: DailyPoint[] = B_DAYS.map((date, i) => ({ date, value: B[i] }));
const returns = { "key-a": aSeries, "key-b": bSeries };
const equity = { "key-a": 10_000, "key-b": 30_000 };
const lists = { "key-b": NAMED };

const holdings = [
  {
    symbol: "BTC", quantity: 1, mark_price_usd: 50_000, value_usd: 10_000, venue: "binance",
    holding_type: "spot" as const, api_key_id: "key-a", side: "flat" as const, entry_price: null,
    unrealized_pnl_usd: null,
  },
  {
    symbol: "BTC", quantity: 1, mark_price_usd: 50_000, value_usd: 30_000, venue: "okx",
    holding_type: "spot" as const, api_key_id: "key-b", side: "flat" as const, entry_price: null,
    unrealized_pnl_usd: null,
  },
];

function inputs(withLists: boolean): ScenarioCompareInputs {
  return {
    addedStrategyReturnsLookup: {},
    addedStrategyMetadataLookup: {},
    perKeyReturnsByApiKeyId: returns,
    contributingApiKeyIds: ["key-a", "key-b"],
    eligibleApiKeyIds: ["key-a", "key-b"],
    equityByApiKeyId: equity,
    perKeyDailiesGateSatisfied: true,
    ...(withLists ? { tinyBaseDaysByApiKeyId: lists } : {}),
  };
}

function savedDraft(): ScenarioDraft {
  return {
    schema_version: 2,
    init_holdings_fingerprint: "fp",
    toggleByScopeRef: {},
    addedStrategies: [],
    weightOverrides: { "key-a": 0.5, "key-b": 0.5 },
    memberKeyIds: ["key-a", "key-b"],
    lastEditedAt: "2026-03-12T00:00:00.000Z",
  };
}

const at = (m: ReturnType<typeof computeMetricsForDraft>, day: string) =>
  m.portfolio_daily_returns!.find((p) => p.date === day)?.value;

describe("buildPerKeyStrategyForBuilderSet - the per-key unit carries its tiny-base days (188 D-07)", () => {
  it("sets undefined_return_days on the key that names days and on no other unit", () => {
    const { strategies } = buildPerKeyStrategyForBuilderSet(returns, equity, new Map(), lists);
    const a = strategies.find((s) => s.id === "key-a")!;
    const b = strategies.find((s) => s.id === "key-b")!;
    expect(b.undefined_return_days).toEqual(NAMED);
    expect(Object.prototype.hasOwnProperty.call(a, "undefined_return_days")).toBe(false);
  });

  it("the 3-argument call is strictly equal to the 4-argument call with no lists", () => {
    expect(buildPerKeyStrategyForBuilderSet(returns, equity, new Map())).toStrictEqual(
      buildPerKeyStrategyForBuilderSet(returns, equity, new Map(), {}),
    );
  });

  it("a list for a key with no series creates no unit", () => {
    const { strategies } = buildPerKeyStrategyForBuilderSet(
      { "key-a": aSeries },
      equity,
      new Map(),
      { "key-ghost": NAMED },
    );
    expect(strategies.map((s) => s.id)).toEqual(["key-a"]);
  });
});

describe("computeMetricsForDraft - every per-key column sits a key out of its tiny-base days (188 D-07)", () => {
  it("the live-book column agrees with the SSR live baseline on one screen, and reads 03-07 as key-a alone", () => {
    const col = computeMetricsForDraft(
      buildLiveBookDraft(true, ["key-a", "key-b"]),
      inputs(true),
      { liveBook: true },
    );
    const ssr = liveBaselineMetricsFromPerKeyDailies(holdings, returns, lists);

    expect(col.twr).toBe(ssr.ytdTwr);
    expect(col.sharpe).toBe(ssr.sharpe);
    expect(col.max_drawdown).toBe(ssr.maxDd);
    expect(col.avg_pairwise_correlation).toBe(ssr.avgRho);
    // key-a alone on the named day, not (0.25 * 0.02 + 0) / 1 = 0.005.
    expect(at(col, "2026-03-07")).toBeCloseTo(0.02, 12);
    expect(at(col, "2026-03-08")).toBeCloseTo(-0.01, 12);
    // Non-vacuity: without the lists the column lands elsewhere.
    const without = computeMetricsForDraft(
      buildLiveBookDraft(true, ["key-a", "key-b"]),
      inputs(false),
      { liveBook: true },
    );
    expect(without.twr).not.toBe(col.twr);
  });

  it("a saved draft over the same keys reads the same days the same way (T-KL1-SCOPE)", () => {
    const m = computeMetricsForDraft(savedDraft(), inputs(true));
    expect(at(m, "2026-03-07")).toBeCloseTo(0.02, 12);
    expect(at(m, "2026-03-08")).toBeCloseTo(-0.01, 12);
    // A shared day at 0.5 / 0.5: (0.01 + 0.03) / 2 = 0.02 on 2026-03-01.
    expect(at(m, "2026-03-01")).toBeCloseTo(0.02, 12);
  });

  it("without tinyBaseDaysByApiKeyId in the inputs every compute equals today's (the old arithmetic)", () => {
    const m = computeMetricsForDraft(savedDraft(), inputs(false));
    // Today's reading of a left-out day: (0.5 * 0.02 + 0) / 1.
    expect(at(m, "2026-03-07")).toBeCloseTo(0.01, 12);
    expect(computeMetricsForDraft(savedDraft(), inputs(false))).toStrictEqual(m);
  });
});
