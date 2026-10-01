/**
 * Phase 169.1 plan 04 (D-83, D-31, D-30; SC4, SC9) — a SINGLE-KEY strategy's
 * compounding method and day basis come from where they are stored, through the
 * ONE resolver the composite path uses (`resolveMetricsConventions`).
 *
 * WHY THIS MATTERS. The Python single-key runner computes the stored headline
 * (Cum. Return, CAGR, Max DD) under the conventions it froze into the
 * `cash_settlement` series row's payload. The live `returns_denominator_config`
 * can be edited after that run. If the curve followed the live config while the
 * headline kept the frozen one, the page would show an equity chart and a
 * "Since Inception" figure computed two different ways, drifting apart with every
 * period (T-169-51). So the frozen echo must decide before the config, in both
 * directions, and the active day basis must reach the payload so the zoom window
 * computes its risk figures over the same days the headline did.
 *
 * The echo is read only for a BUILD. A probe decides buildability, which does not
 * depend on the method, so /strategies (which probes every computed row on every
 * load) gains no per-row query (T-169-53). A failed read degrades to the config
 * tier and logs; the factsheet still builds (D-30).
 *
 * The admin double is the hoisted-state builder of `fetch-and-build-payload.test.ts`
 * with a `strategy_analytics_series` branch that answers the conventions select.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

type Row = Record<string, unknown>;

const CONVENTIONS_SELECT = "conventions:payload->conventions";

const fake = vi.hoisted(() => ({
  strategyResult: { data: null as unknown, error: null as unknown },
  /** The frozen echo the cash_settlement row carries; null = no row. */
  conventions: null as Record<string, unknown> | null,
  conventionsError: null as unknown,
  conventionsThrows: false,
  /** Every select string a strategy_analytics_series read asked for. */
  analyticsSelects: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const self = () => b;
    let selected = "";
    b.select = (s?: string) => {
      selected = String(s);
      if (table === "strategy_analytics_series") fake.analyticsSelects.push(selected);
      return b;
    };
    b.eq = self;
    b.order = self;
    b.limit = self;
    b.or = self;
    b.abortSignal = self;
    b.maybeSingle = async () => {
      if (table === "strategies") return fake.strategyResult;
      if (table === "strategy_analytics_series" && selected === CONVENTIONS_SELECT) {
        if (fake.conventionsThrows) throw new Error("socket hang up");
        if (fake.conventionsError) return { data: null, error: fake.conventionsError };
        return { data: fake.conventions === null ? null : { conventions: fake.conventions }, error: null };
      }
      return { data: null, error: null };
    };
    if (table === "csv_daily_returns") {
      // The composite reader's date-keyset pages (SFH HIGH-1's composite arm):
      // a page after the first carries `.gt("date", cursor)`, and an empty page
      // ends it.
      let after: string | null = null;
      b.gt = (_c: string, v: string) => {
        after = v;
        return b;
      };
      b.limit = async () => ({
        data: dailyReturns()
          .filter((r) => after === null || r.date > after)
          .map((r) => ({ date: r.date, daily_return: r.value })),
        error: null,
      });
    }
    if (table === "benchmark_prices") {
      // An empty successful page ends the BTC keyset reader at once.
      b.gte = self;
      b.lte = self;
      b.lt = self;
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    }
    return b;
  }
  return { createAdminClient: () => ({ from: (table: string) => builder(table) }) };
});

import {
  fetchAndBuildPayload,
  fetchAndBuildPayloadWithReason,
  probeFactsheetBuildable,
} from "./fetch-and-build-payload";
import { captureToSentry } from "@/lib/sentry-capture";

const STRATEGY_ID = "00000000-0000-4000-8000-0000000000d4";
const publicVisibility = <Q,>(q: Q): Q => q;

/**
 * 200 daily returns with a drift, so the arithmetic SUM (0.32) and the geometric
 * COMPOUND differ by far more than any tolerance below. Every 10th day is zero,
 * so an active day basis has days to exclude.
 */
const RETURNS: number[] = Array.from({ length: 200 }, (_, i) => (i % 10 === 9 ? 0 : 0.004 + ((i % 5) - 2) / 100));
const SUM = RETURNS.reduce((s, r) => s + r, 0);
const COMPOUND = RETURNS.reduce((p, r) => p * (1 + r), 1) - 1;

function dailyReturns(): { date: string; value: number }[] {
  const start = Date.parse("2024-01-02T00:00:00Z");
  return RETURNS.map((value, i) => ({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), value }));
}

function seedStrategy(config: unknown, cumulativeReturn: number = SUM) {
  fake.strategyResult = {
    data: {
      id: STRATEGY_ID,
      name: "Single-Key Conventions Fixture",
      codename: null,
      disclosure_tier: null,
      status: "published",
      markets: [],
      strategy_types: [],
      description: null,
      subtypes: [],
      supported_exchanges: [],
      leverage_range: null,
      aum: null,
      max_capacity: null,
      avg_daily_turnover: null,
      start_date: null,
      benchmark: null,
      asset_class: "crypto",
      returns_denominator_config: config,
      strategy_analytics: {
        daily_returns: dailyReturns(),
        returns_series: null,
        computed_at: "2024-08-01T00:00:00Z",
        data_quality_flags: null,
        metrics_json_by_basis: null,
        computation_status: "complete",
        // The seven persisted headline scalars (BASIS_KPI_MAP), so the stored
        // headline is overlaid as it is in production (D-10).
        cumulative_return: cumulativeReturn,
        volatility: 0.3,
        max_drawdown: -0.1,
        cagr: 0.7,
        sharpe: 2.1,
        sortino: 3.2,
        calmar: 7,
      } as Row,
    },
    error: null,
  };
}

const conventionsReads = () => fake.analyticsSelects.filter((s) => s === CONVENTIONS_SELECT).length;

beforeEach(() => {
  fake.strategyResult = { data: null, error: null };
  fake.conventions = null;
  fake.conventionsError = null;
  fake.conventionsThrows = false;
  fake.analyticsSelects = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(console.warn).mockClear();
  vi.mocked(console.error).mockClear();
  vi.mocked(captureToSentry).mockClear();
});

/** The one Sentry event a degraded build sends (169.1 SFH HIGH-1). */
const conventionsCaptures = () =>
  vi.mocked(captureToSentry).mock.calls.filter(
    (c) => (c[1] as { tags?: { reason?: string } } | undefined)?.tags?.reason === "conventions_read_error",
  );

describe("169.1-04 D-83 (a): the frozen conventions echo decides before the live config", () => {
  it("ECHO BEATS A NULL CONFIG: echo simple + active draws the arithmetic curve and carries the active day basis", async () => {
    seedStrategy(null);
    fake.conventions = { cumulative_method: "simple", day_basis: "active" };
    const payload = await fetchAndBuildPayload(STRATEGY_ID, publicVisibility);
    expect(payload).not.toBeNull();
    expect(payload!.cumulativeMethod).toBe("arithmetic");
    expect(payload!.dayBasis).toBe("active");
    expect(payload!.dataQuality?.returnsConventionOverride).toBe(true);
    // The curve is the running SUM the stored headline was computed as.
    expect(payload!.strategyEquity.at(-1)! - 1).toBeCloseTo(SUM, 10);
    expect(Math.abs(SUM - COMPOUND)).toBeGreaterThan(0.01);
    // The build read the echo exactly once.
    expect(conventionsReads()).toBe(1);
  });

  it("ECHO BEATS THE LIVE CONFIG: echo geometric + calendar wins over a config edited to simple after the run", async () => {
    seedStrategy({ cumulative_method: "simple" }, COMPOUND);
    fake.conventions = { cumulative_method: "geometric", day_basis: "calendar" };
    const payload = await fetchAndBuildPayload(STRATEGY_ID, publicVisibility);
    expect(payload).not.toBeNull();
    expect("cumulativeMethod" in payload!).toBe(false);
    expect("dayBasis" in payload!).toBe(false);
    expect(payload!.dataQuality?.returnsConventionOverride).toBeUndefined();
    expect(payload!.strategyEquity.at(-1)! - 1).toBeCloseTo(COMPOUND, 10);
  });

  it("CONFIG TIER: with no conventions row, a simple config still draws the arithmetic curve (HEAD's behaviour, kept)", async () => {
    seedStrategy({ cumulative_method: "simple" });
    const payload = await fetchAndBuildPayload(STRATEGY_ID, publicVisibility);
    expect(payload).not.toBeNull();
    expect(payload!.cumulativeMethod).toBe("arithmetic");
    expect(payload!.dataQuality?.returnsConventionOverride).toBe(true);
    expect(payload!.strategyEquity.at(-1)! - 1).toBeCloseTo(SUM, 10);
  });

  it("HEADLINE = CURVE: the persisted Cum. Return the KPI strip shows equals the arithmetic curve's endpoint minus 1", async () => {
    seedStrategy(null, SUM);
    fake.conventions = { cumulative_method: "simple", day_basis: "active" };
    const payload = await fetchAndBuildPayload(STRATEGY_ID, publicVisibility);
    expect(payload).not.toBeNull();
    // D-10: the top-level cum_ret is the persisted headline, not a recomputation.
    expect(payload!.strategyMetrics.cum_ret).toBe(SUM);
    expect(payload!.strategyMetrics.cum_ret!).toBeCloseTo(payload!.strategyEquity.at(-1)! - 1, 10);
  });
});

describe("169.1-04 D-83 (b): a default single-key payload gains no key", () => {
  it("DEFAULT: an echo of geometric + calendar builds the same payload as no echo at all, with none of the new keys", async () => {
    seedStrategy(null, COMPOUND);
    const bare = await fetchAndBuildPayload(STRATEGY_ID, publicVisibility);
    seedStrategy(null, COMPOUND);
    fake.conventions = { cumulative_method: "geometric", day_basis: "calendar" };
    const echoed = await fetchAndBuildPayload(STRATEGY_ID, publicVisibility);
    expect(bare).not.toBeNull();
    expect(echoed).toEqual(bare);
    for (const p of [bare!, echoed!]) {
      expect("cumulativeMethod" in p).toBe(false);
      expect("dayBasis" in p).toBe(false);
      expect(p.dataQuality?.returnsConventionOverride).toBeUndefined();
    }
  });
});

describe("169.1-04 D-30: a failed conventions read degrades to the config tier and the factsheet still builds", () => {
  it("READ ERROR: an error result logs and the simple config decides", async () => {
    seedStrategy({ cumulative_method: "simple" });
    fake.conventionsError = { message: "upstream timeout", code: "57014" };
    const payload = await fetchAndBuildPayload(STRATEGY_ID, publicVisibility);
    expect(payload).not.toBeNull();
    expect(payload!.cumulativeMethod).toBe("arithmetic");
    expect(payload!.strategyEquity.at(-1)! - 1).toBeCloseTo(SUM, 10);
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).includes("conventions read failed"))).toBe(
      true,
    );
    // SFH HIGH-1: `console.*` does not reach Sentry in this repo, so the build
    // that shipped on the config tier is captured once, with the read's code.
    expect(conventionsCaptures()).toHaveLength(1);
    expect(conventionsCaptures()[0][1]).toMatchObject({
      tags: {
        stage: "factsheet-resolve",
        caller: "build",
        reason: "conventions_read_error",
        code: "57014",
        strategy_id: STRATEGY_ID,
        read: "cash_settlement",
      },
      extra: { errorMessage: "upstream timeout" },
    });
  });

  it("READ THROWS: a thrown chain logs and the geometric default decides", async () => {
    seedStrategy(null, COMPOUND);
    fake.conventionsThrows = true;
    const payload = await fetchAndBuildPayload(STRATEGY_ID, publicVisibility);
    expect(payload).not.toBeNull();
    expect("cumulativeMethod" in payload!).toBe(false);
    expect(payload!.strategyEquity.at(-1)! - 1).toBeCloseTo(COMPOUND, 10);
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).includes("conventions read threw"))).toBe(
      true,
    );
    expect(conventionsCaptures()).toHaveLength(1);
    expect(conventionsCaptures()[0][1]).toMatchObject({
      tags: { reason: "conventions_read_error", code: "threw" },
      extra: { errorMessage: "socket hang up" },
    });
  });

  it("DEGRADED MARKER: a failed read marks the build result degraded, so the public cache refuses it (SFH HIGH-1)", async () => {
    seedStrategy({ cumulative_method: "simple" });
    fake.conventionsError = { message: "upstream timeout", code: "57014" };
    const built = await fetchAndBuildPayloadWithReason(STRATEGY_ID, publicVisibility);
    expect(built.payload).not.toBeNull();
    expect(built.reason).toBeNull();
    expect(built).toMatchObject({ conventionsDegraded: true });
  });

  it("CONTROL: a clean read (and an absent row) is not degraded and captures nothing", async () => {
    seedStrategy({ cumulative_method: "simple" });
    fake.conventions = { cumulative_method: "geometric", day_basis: "calendar" };
    const clean = await fetchAndBuildPayloadWithReason(STRATEGY_ID, publicVisibility);
    expect("conventionsDegraded" in clean, "a clean build carries the degraded key").toBe(false);
    fake.conventions = null;
    const absent = await fetchAndBuildPayloadWithReason(STRATEGY_ID, publicVisibility);
    expect("conventionsDegraded" in absent, "an absent row is a fact, not an outage").toBe(false);
    expect(conventionsCaptures()).toHaveLength(0);
  });
});

describe("169.1 SFH HIGH-1: the composite arm marks and captures a failed conventions read for a build only", () => {
  function seedComposite() {
    seedStrategy({ cumulative_method: "simple", metrics_basis: "active_day" });
    const row = fake.strategyResult.data as Row;
    row.strategy_analytics = {
      ...(row.strategy_analytics as Row),
      daily_returns: null,
      data_quality_flags: { composite: true },
      metrics_json_by_basis: {
        cash_settlement: {
          cumulative_return: SUM,
          cagr: 0.7,
          volatility: 0.3,
          sharpe: 2.1,
          sortino: 3.2,
          calmar: 7,
          max_drawdown: -0.1,
        },
      },
    };
    fake.conventionsError = { message: "upstream timeout", code: "57014" };
  }

  it("BUILD: degraded, built on the config tier, captured once", async () => {
    seedComposite();
    const built = await fetchAndBuildPayloadWithReason(STRATEGY_ID, publicVisibility);
    expect(built.payload).not.toBeNull();
    expect(built.payload!.cumulativeMethod).toBe("arithmetic");
    expect(built.payload!.dayBasis).toBe("active");
    expect(built).toMatchObject({ conventionsDegraded: true });
    expect(conventionsCaptures()).toHaveLength(1);
    expect(conventionsCaptures()[0][1]).toMatchObject({ tags: { caller: "build", code: "57014" } });
  });

  it("PROBE: buildable, and no capture (167.2.1-REVIEW-R2 WR-01: a probe never captures)", async () => {
    seedComposite();
    const probe = await probeFactsheetBuildable(STRATEGY_ID, publicVisibility);
    expect(probe).toEqual({ buildable: true });
    expect(conventionsReads(), "the composite probe did read the conventions").toBe(1);
    expect(conventionsCaptures()).toHaveLength(0);
  });
});

describe("169.1-04 D-83 (a): a probe issues no conventions query", () => {
  const FIXTURES: Array<{ name: string; config: unknown; conventions: Record<string, unknown> | null }> = [
    { name: "echo simple + active, null config", config: null, conventions: { cumulative_method: "simple", day_basis: "active" } },
    { name: "echo geometric, simple config", config: { cumulative_method: "simple" }, conventions: { cumulative_method: "geometric", day_basis: "calendar" } },
    { name: "no echo, simple config", config: { cumulative_method: "simple" }, conventions: null },
    { name: "default", config: null, conventions: { cumulative_method: "geometric", day_basis: "calendar" } },
  ];
  for (const f of FIXTURES) {
    it(`PROBE ${f.name}: buildable, and zero conventions selects`, async () => {
      seedStrategy(f.config);
      fake.conventions = f.conventions;
      const probe = await probeFactsheetBuildable(STRATEGY_ID, publicVisibility);
      expect(probe).toEqual({ buildable: true });
      expect(conventionsReads()).toBe(0);
      expect(fake.analyticsSelects).toEqual([]);
    });
  }
});
