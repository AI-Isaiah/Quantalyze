import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import * as readPath from "./composite-read-path";
import { CompositeSeriesReadError, readCompositeFactsheet } from "./composite-read-path";

/**
 * Phase 169.1 plan 03 (D-30) — the composite read path resolves the compounding
 * method AND the day basis from where they are stored: the persisted
 * `data_quality_flags.cumulative_method` (frozen at stitch), then the
 * `conventions` echo the engine froze into the `cash_settlement` series row,
 * then the live `returns_denominator_config`. Before this plan the read path
 * resolved only the method and skipped the conventions echo, and the day basis
 * was never read at all, so an active-day-basis composite's zoom window
 * re-derived its vol, Sharpe and Sortino over zero days the engine excludes.
 *
 * The conventions read CHOOSES a convention; it does not decide whether the
 * factsheet builds. So, unlike the MTM / smoothed / csv reads, a failed read
 * logs and degrades to the config tier and never throws (D-30, D-78).
 */

const SPARSE_ROWS = [
  { date: "2025-08-01", daily_return: 0.01 },
  { date: "2025-08-02", daily_return: -0.005 },
  { date: "2025-08-05", daily_return: 0.02 },
];
const FULL_CASH = {
  cumulative_return: 0.12,
  cagr: 0.2,
  volatility: 0.3,
  sharpe: 1.1,
  sortino: 1.4,
  calmar: 0.9,
  max_drawdown: -0.08,
};

type ConventionsAnswer =
  | { kind: "row"; conventions: unknown }
  | { kind: "no-row" }
  | { kind: "error"; message: string }
  | { kind: "throw" };

/**
 * An admin client answering the sparse csv read and the `cash_settlement`
 * conventions read; it records the select string that read asked for.
 */
function mockAdmin(answer: ConventionsAnswer) {
  const seen: { selects: string[]; kinds: string[] } = { selects: [], kinds: [] };
  const from = (table: string) => {
    if (table === "strategy_analytics_series") {
      let kind: string | undefined;
      let select = "";
      const chain = {
        select: (s: string) => {
          select = s;
          return chain;
        },
        eq: (col: string, val: string) => {
          if (col === "kind") kind = val;
          return chain;
        },
        maybeSingle: () => {
          seen.selects.push(select);
          seen.kinds.push(kind ?? "");
          if (answer.kind === "throw") throw new Error("synthetic chain throw");
          if (answer.kind === "error") return Promise.resolve({ data: null, error: { message: answer.message, code: "57014" } });
          if (answer.kind === "no-row") return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: { conventions: answer.conventions }, error: null });
        },
      };
      return chain;
    }
    let after: string | null = null;
    const csv = {
      select: () => csv,
      eq: () => csv,
      gt: (_c: string, v: string) => {
        after = v;
        return csv;
      },
      order: () => csv,
      limit: () => Promise.resolve({ data: SPARSE_ROWS.filter((r) => after === null || r.date > after), error: null }),
    };
    return csv;
  };
  return { admin: { from } as unknown as SupabaseClient, seen };
}

function read(
  admin: SupabaseClient,
  over: { dqf?: Record<string, unknown> | null; returnsDenominatorConfig?: unknown } = {},
) {
  return readCompositeFactsheet(admin, {
    strategyId: "s-conv",
    dqf: over.dqf === undefined ? { composite: true } : over.dqf,
    metricsJsonByBasis: { cash_settlement: FULL_CASH },
    returnsDenominatorConfig: over.returnsDenominatorConfig ?? null,
  });
}

let warn: { mock: { calls: unknown[][] }; mockRestore: () => void };
let error: { mock: { calls: unknown[][] }; mockRestore: () => void };
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe("readCompositeFactsheet resolves the method and the day basis from the cash_settlement conventions (D-30)", () => {
  it("no persisted method and no config: the conventions echo decides both (simple -> arithmetic, active)", async () => {
    const { admin } = mockAdmin({ kind: "row", conventions: { cumulative_method: "simple", day_basis: "active" } });
    const out = await read(admin);
    expect(out!.buildOpts.cumulativeMethod).toBe("arithmetic");
    expect(out!.buildOpts.dayBasis).toBe("active");
  });

  it("reads the conventions by JSON path from the cash_settlement row's payload, never the whole payload", async () => {
    const { admin, seen } = mockAdmin({ kind: "row", conventions: { cumulative_method: "geometric", day_basis: "calendar" } });
    await read(admin);
    const i = seen.kinds.indexOf("cash_settlement");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(seen.selects[i]).toBe("conventions:payload->conventions");
  });
});

describe("the tier order (D-30)", () => {
  it("method: a persisted data_quality_flags.cumulative_method wins over the conventions echo", async () => {
    const { admin } = mockAdmin({ kind: "row", conventions: { cumulative_method: "simple", day_basis: "calendar" } });
    const out = await read(admin, { dqf: { composite: true, cumulative_method: "geometric" } });
    expect(out!.buildOpts.cumulativeMethod).toBe("geometric");
  });

  it("method: with neither a persisted method nor a conventions row, a simple config gives arithmetic", async () => {
    const { admin } = mockAdmin({ kind: "no-row" });
    const out = await read(admin, { returnsDenominatorConfig: { cumulative_method: "simple" } });
    expect(out!.buildOpts.cumulativeMethod).toBe("arithmetic");
  });

  it("day basis: the conventions echo's calendar wins over a config active_day", async () => {
    const { admin } = mockAdmin({ kind: "row", conventions: { cumulative_method: "geometric", day_basis: "calendar" } });
    const out = await read(admin, { returnsDenominatorConfig: { metrics_basis: "active_day" } });
    expect(out!.buildOpts.dayBasis).toBe("calendar");
  });

  it("day basis: with no conventions row, the config decides (active_day -> active, calendar_day -> calendar)", async () => {
    const a = await read(mockAdmin({ kind: "no-row" }).admin, { returnsDenominatorConfig: { metrics_basis: "active_day" } });
    expect(a!.buildOpts.dayBasis).toBe("active");
    const c = await read(mockAdmin({ kind: "no-row" }).admin, { returnsDenominatorConfig: { metrics_basis: "calendar_day" } });
    expect(c!.buildOpts.dayBasis).toBe("calendar");
  });

  it("day basis: with neither, calendar", async () => {
    const out = await read(mockAdmin({ kind: "no-row" }).admin);
    expect(out!.buildOpts.dayBasis).toBe("calendar");
  });
});

describe("an unexpected conventions value is ignored loudly and the next tier decides (D-30)", () => {
  it("day_basis 'weekly' warns naming the strategy and the value; the config's active_day decides", async () => {
    const { admin } = mockAdmin({ kind: "row", conventions: { cumulative_method: "geometric", day_basis: "weekly" } });
    const out = await read(admin, { returnsDenominatorConfig: { metrics_basis: "active_day" } });
    expect(out!.buildOpts.dayBasis).toBe("active");
    const hit = warn.mock.calls.find((c) => JSON.stringify(c).includes("weekly"));
    expect(hit, "a warn naming the unexpected value").toBeDefined();
    expect(JSON.stringify(hit)).toContain("s-conv");
  });

  it("cumulative_method 'log' warns and the config decides", async () => {
    const { admin } = mockAdmin({ kind: "row", conventions: { cumulative_method: "log", day_basis: "calendar" } });
    const out = await read(admin, { returnsDenominatorConfig: { cumulative_method: "simple" } });
    expect(out!.buildOpts.cumulativeMethod).toBe("arithmetic");
    const hit = warn.mock.calls.find((c) => JSON.stringify(c).includes('"log"'));
    expect(hit, "a warn naming the unexpected value").toBeDefined();
    expect(JSON.stringify(hit)).toContain("s-conv");
  });
});

describe("a failed conventions read degrades to the config tier and never breaks the factsheet (D-30, D-78)", () => {
  it("an error result logs an error, does NOT throw CompositeSeriesReadError, and the config decides", async () => {
    const { admin } = mockAdmin({ kind: "error", message: "synthetic conventions outage" });
    const out = await read(admin, {
      returnsDenominatorConfig: { cumulative_method: "simple", metrics_basis: "active_day" },
    }).catch((e: unknown) => e);
    expect(out).not.toBeInstanceOf(CompositeSeriesReadError);
    expect(out).not.toBeInstanceOf(Error);
    const built = out as Awaited<ReturnType<typeof read>>;
    expect(built).not.toBeNull();
    expect(built!.buildOpts.cumulativeMethod).toBe("arithmetic");
    expect(built!.buildOpts.dayBasis).toBe("active");
    const hit = error.mock.calls.find((c) => JSON.stringify(c).includes("synthetic conventions outage"));
    expect(hit, "a console.error carrying the read's message").toBeDefined();
    expect(JSON.stringify(hit)).toContain("s-conv");
  });

  it("a THROWING query chain logs an error and degrades the same way", async () => {
    const { admin } = mockAdmin({ kind: "throw" });
    const out = await read(admin, { returnsDenominatorConfig: { metrics_basis: "active_day" } });
    expect(out).not.toBeNull();
    expect(out!.buildOpts.dayBasis).toBe("active");
    expect(error.mock.calls.some((c) => JSON.stringify(c).includes("synthetic chain throw"))).toBe(true);
  });

  it("a client that does not answer the conventions query at all (from() returns undefined) still builds", async () => {
    const csvOnly = mockAdmin({ kind: "no-row" }).admin as unknown as { from: (t: string) => unknown };
    const admin = {
      from: (t: string) => (t === "strategy_analytics_series" ? undefined : csvOnly.from(t)),
    } as unknown as SupabaseClient;
    const out = await read(admin);
    expect(out).not.toBeNull();
    expect(out!.buildOpts.cumulativeMethod).toBe("geometric");
    expect(out!.buildOpts.dayBasis).toBe("calendar");
  });
});

describe("the exported seams plan 169.1-04 reuses (D-83)", () => {
  it("resolveMetricsConventions and readCashConventions are exported", () => {
    expect(typeof (readPath as Record<string, unknown>).resolveMetricsConventions).toBe("function");
    expect(typeof (readPath as Record<string, unknown>).readCashConventions).toBe("function");
  });
});
