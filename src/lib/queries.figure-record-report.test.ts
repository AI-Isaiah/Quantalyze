/**
 * Phase 194 review R5 SFH-M3: an unreadable record (a present but malformed date) withholds the
 * annualised figures, and until now nothing told anyone. The two list producers that build a
 * record in `queries.ts` report it at the producer, with the strategy id and the dates that
 * decide it, and never from a render-time gate. Each case fails when its report is removed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  queryResult: { data: null as unknown, error: null as unknown },
}));

function builder() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
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
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// 194.2: the producers dedupe per record in module state, so each case loads a FRESH module (and the
// mock module it reports to) instead of inheriting the previous case's "already reported" keys.
let getOwnCapitalStrategies: typeof import("./queries").getOwnCapitalStrategies;
let getPercentiles: typeof import("./queries").getPercentiles;
let captureToSentry: typeof import("@/lib/sentry-capture").captureToSentry;

const reports = () =>
  vi
    .mocked(captureToSentry)
    .mock.calls.filter(([, ctx]) => (ctx.tags as Record<string, string>).reason === "figure-record-unreadable");

beforeEach(async () => {
  vi.resetModules();
  ({ getOwnCapitalStrategies, getPercentiles } = await import("./queries"));
  ({ captureToSentry } = await import("@/lib/sentry-capture"));
  state.queryResult = { data: null, error: null };
});

describe("getPercentiles reports an unreadable percentile record (R5 SFH-M3)", () => {
  const kpis = (sharpe: number) => ({
    computation_status: "complete",
    sharpe,
    cagr: sharpe / 10,
    sortino: sharpe,
    calmar: sharpe,
    volatility: 0.1 * sharpe,
    max_drawdown: -0.1,
    cumulative_return: 0.1,
  });
  const LONG = { series_start: "2025-01-01", series_end: "2026-03-02", headline_since: null, record_observations: 300 };
  const rows = (headline: string | null) =>
    ["A", "B", "C", "D", "E"].map((id, i) => ({
      id,
      asset_class: "crypto",
      strategy_analytics: { ...kpis(i + 1), ...LONG, ...(id === "E" ? { headline_since: headline } : {}) },
    }));

  it("a malformed headline_since withholds the row's annualised ranks and reports once, naming the strategy and the date", async () => {
    state.queryResult = { data: rows("2026-13-99"), error: null };
    const map = (await getPercentiles())!;
    expect(map.E.sharpe).toBeUndefined();
    expect(map.A.sharpe).toBeDefined();
    expect(reports()).toHaveLength(1);
    const [err, ctx] = reports()[0];
    expect(err).toBeInstanceOf(Error);
    expect(ctx.tags).toMatchObject({ op: "percentileRecord" });
    expect(ctx.extra).toMatchObject({ strategyId: "E", headlineSince: "2026-13-99" });
  });

  it("194.2 WR-02: a PRESENT non-string headline_since (a number) is unreadable like the SQL arm's text, not absent: ranks withheld, reported", async () => {
    state.queryResult = { data: rows(20260201 as unknown as string), error: null };
    const map = (await getPercentiles())!;
    expect(map.E.sharpe).toBeUndefined();
    expect(map.A.sharpe).toBeDefined();
    expect(reports()).toHaveLength(1);
    expect(reports()[0][1].extra).toMatchObject({ strategyId: "E", headlineSince: "20260201" });
  });

  it("one bad record reports ONCE across repeated reads; a different bad record reports again (194.2 dedup)", async () => {
    state.queryResult = { data: rows("2026-13-99"), error: null };
    await getPercentiles();
    await getPercentiles();
    expect(reports()).toHaveLength(1);
    state.queryResult = { data: rows("2026-14-99"), error: null };
    await getPercentiles();
    expect(reports()).toHaveLength(2);
    expect(reports()[1][1].extra).toMatchObject({ strategyId: "E", headlineSince: "2026-14-99" });
  });

  it("194.2 WR-03: a report whose send THROWS is not recorded as sent; the next read of the same record reports again", async () => {
    state.queryResult = { data: rows("2026-13-99"), error: null };
    vi.mocked(captureToSentry).mockImplementationOnce(() => {
      throw new Error("sentry transport down");
    });
    await getPercentiles().catch(() => null);
    expect(reports()).toHaveLength(1); // the throwing attempt
    await getPercentiles();
    expect(reports()).toHaveLength(2); // retried, not suppressed for the process lifetime
    await getPercentiles();
    expect(reports()).toHaveLength(2); // and once it sent, dedup holds
  });

  it("control: readable records report nothing", async () => {
    state.queryResult = { data: rows(null), error: null };
    const map = (await getPercentiles())!;
    expect(map.E.sharpe).toBeDefined();
    expect(reports()).toHaveLength(0);
  });
});

describe("getOwnCapitalStrategies reports an unreadable Holdings record (R5 SFH-M3)", () => {
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
      record_observations: undefined,
    },
  });
  const read = async (flags: unknown) => {
    state.queryResult = { data: [row(flags)], error: null };
    const out = await getOwnCapitalStrategies("00000000-0000-4000-8000-0000000000bb");
    expect(out).not.toBeNull();
    return out![0];
  };

  it("serves the verdict as the figure_unreadable scalar (194.2 D-01): true for a malformed date, false otherwise", async () => {
    expect((await read({ headline_since: "2026-13-99" })).figure_unreadable).toBe(true);
    // 194.2 D-01: a day-shaped prefix with trailing text is kept verbatim, not read as 2026-01-0.
    expect((await read({ headline_since: "2026-01-0x" })).figure_unreadable).toBe(true);
    expect((await read({ headline_since: "2026-02-01" })).figure_unreadable).toBe(false);
    expect((await read(null)).figure_unreadable).toBe(false);
  });

  it("194.2 WR-02: a PRESENT non-string headline_since (number, boolean, object) is unreadable, not absent; an empty string is absent", async () => {
    for (const bad of [20260201, true, { d: "2026-02-01" }]) {
      expect((await read({ headline_since: bad })).figure_unreadable).toBe(true);
    }
    expect((await read({ headline_since: "" })).figure_unreadable).toBe(false);
  });

  it("a headline_since that is shaped like a day but is not one reports, naming the strategy", async () => {
    await read({ headline_since: "2026-13-99" });
    expect(reports()).toHaveLength(1);
    const [, ctx] = reports()[0];
    expect(ctx.tags).toMatchObject({ op: "figureRecordScalars" });
    expect(ctx.extra).toMatchObject({ strategyId: "s-1", headlineSince: "2026-13-99" });
  });

  it("figureRecordScalars: two reads of one unreadable record report once; a different record reports again (194.2 dedup)", async () => {
    await read({ headline_since: "2026-13-99" });
    await read({ headline_since: "2026-13-99" });
    expect(reports()).toHaveLength(1);
    await read({ headline_since: "2026-13-98" });
    expect(reports()).toHaveLength(2);
  });

  it("control: a readable record, and an absent headline_since, report nothing", async () => {
    await read({ headline_since: "2026-02-01" });
    await read(null);
    expect(reports()).toHaveLength(0);
  });
});

describe("shapeRowAnalytics: an owner-arm returns_series[0].date that is present but not a string (194.2 WR-02)", () => {
  it("is carried as text so the record is unreadable; a null or empty first date stays absent", async () => {
    const { shapeRowAnalytics } = await import("./queries");
    const { rowRecord } = await import("@/components/strategy/annualized-cell");
    const shaped = (first: unknown) =>
      shapeRowAnalytics(
        {
          computation_status: "complete",
          returns_series: [{ date: first, value: 1 }, { date: "2026-03-02", value: 1.01 }],
          data_quality_flags: null,
          metrics_json: { record_observations: 120 },
        } as never,
        "s-1",
      );
    for (const bad of [20260101, true, { y: 2026 }]) {
      expect(rowRecord({ asset_class: "crypto", analytics: shaped(bad) }).unreadable).toBe(true);
    }
    for (const absent of [null, ""]) {
      expect(rowRecord({ asset_class: "crypto", analytics: shaped(absent) }).unreadable).toBeFalsy();
    }
  });
});
