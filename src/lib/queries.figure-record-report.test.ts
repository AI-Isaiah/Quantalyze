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

import { getOwnCapitalStrategies, getPercentiles } from "./queries";
import { captureToSentry } from "@/lib/sentry-capture";

const reports = () =>
  vi
    .mocked(captureToSentry)
    .mock.calls.filter(([, ctx]) => (ctx.tags as Record<string, string>).reason === "figure-record-unreadable");

beforeEach(() => {
  vi.mocked(captureToSentry).mockClear();
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
  };

  it("a headline_since that is shaped like a day but is not one reports, naming the strategy", async () => {
    await read({ headline_since: "2026-13-99" });
    expect(reports()).toHaveLength(1);
    const [, ctx] = reports()[0];
    expect(ctx.tags).toMatchObject({ op: "figureRecordScalars" });
    expect(ctx.extra).toMatchObject({ strategyId: "s-1", headlineSince: "2026-13-99" });
  });

  it("control: a readable record, and an absent headline_since, report nothing", async () => {
    await read({ headline_since: "2026-02-01" });
    await read(null);
    expect(reports()).toHaveLength(0);
  });
});
