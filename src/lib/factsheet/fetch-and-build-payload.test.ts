/**
 * Phase 167.2.1 (FACTSHEETBUILDABLE) — the unit half of the WR-02 reproduction.
 *
 * THE MISMATCH. A strategy whose `strategy_analytics.computation_status` reads
 * 'complete' is called "computed" by every owner surface, yet
 * `fetchAndBuildPayload` can still answer null for it: a single-key row with
 * fewer than 2 distinct dated returns, or a composite whose persisted
 * `cash_settlement` headline is absent (a pre-Phase-86 composite). The share
 * recipient then lands on the "not available" card while the owner was told
 * nothing. These cases reproduce that on a mocked service-role client, with a
 * CONTROL row proving the harness can build at all, so a green REPRO arm cannot
 * be a harness that never builds anything.
 *
 * The same populations are reproduced on real rows by the live-DB spec
 * `src/__tests__/factsheet-buildable-live-db.test.ts`. This file must never
 * name that spec's gate symbol: the lane-corpus walker selects files by that
 * substring, and this unit file belongs to the ordinary shards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

const fake = vi.hoisted(() => ({
  strategyResult: { data: null as unknown, error: null as unknown },
  csvRows: [] as { date: string; daily_return: number }[],
  tablesSeen: [] as string[],
  orFilters: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self;
    b.eq = self;
    b.order = self;
    b.limit = self;
    b.or = (filter: string) => {
      fake.orFilters.push(filter);
      return b;
    };
    b.maybeSingle = async () => {
      if (table === "strategies") return fake.strategyResult;
      // strategy_analytics_series and anything else: no row.
      return { data: null, error: null };
    };
    if (table === "csv_daily_returns") {
      // The composite read awaits the builder itself after `.limit(...)`.
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: fake.csvRows, error: null });
    }
    return b;
  }
  return {
    createAdminClient: () => ({
      from: (table: string) => {
        fake.tablesSeen.push(table);
        return builder(table);
      },
    }),
  };
});

// Wrap the real builder in a spy, so the probe can be proven never to build.
vi.mock("./build-payload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./build-payload")>();
  return { ...actual, buildFactsheetPayload: vi.fn(actual.buildFactsheetPayload) };
});

import { fetchAndBuildPayload, probeFactsheetBuildable } from "./fetch-and-build-payload";
import type { NotBuildableReason } from "./fetch-and-build-payload";
import { buildFactsheetPayload } from "./build-payload";
import { withPublishedOrOwner } from "@/lib/visibility";

// Synthetic, UUID-shaped ids: `withPublishedOrOwner` fails closed on a non-UUID.
const OWNER_ID = "00000000-0000-4000-8000-0000000000a1";
const STRATEGY_ID = "00000000-0000-4000-8000-0000000000b2";
const ownerVisibility = <Q,>(q: Q): Q => withPublishedOrOwner(q, OWNER_ID);

/** N consecutive synthetic calendar days from 2024-01-02, as {date, value}. */
function points(n: number): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const start = Date.parse("2024-01-02T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date, value: ((i % 7) - 3) / 1000 });
  }
  return out;
}

function strategyRow(analytics: Row): Row {
  return {
    id: STRATEGY_ID,
    name: "Synthetic Buildability Fixture",
    codename: null,
    disclosure_tier: null,
    status: "draft",
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
    returns_denominator_config: null,
    strategy_analytics: analytics,
  };
}

function analyticsRow(over: Row): Row {
  return {
    daily_returns: null,
    returns_series: null,
    computed_at: "2024-03-01T00:00:00Z",
    data_quality_flags: null,
    metrics_json_by_basis: null,
    computation_status: "complete",
    ...over,
  };
}

function seed(
  row: Row | null,
  csv: { date: string; daily_return: number }[] = [],
  error: unknown = null,
) {
  fake.strategyResult = { data: row, error };
  fake.csvRows = csv;
}

beforeEach(() => {
  fake.strategyResult = { data: null, error: null };
  fake.csvRows = [];
  fake.tablesSeen = [];
  fake.orFilters = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("WR-02 reproduction — the owner reads 'complete' and the builder answers null", () => {
  it("REPRO-SINGLE-ONE-POINT: a complete single-key row with ONE dated return builds nothing", async () => {
    const row = strategyRow(analyticsRow({ daily_returns: [{ date: "2024-01-02", value: 0.01 }] }));
    seed(row);
    // What the owner's surfaces read: the embed's status is a terminal success.
    expect((row.strategy_analytics as Row).computation_status).toBe("complete");
    const payload = await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);
    expect(payload).toBeNull();
    expect(fake.orFilters.some((f) => f.includes(OWNER_ID))).toBe(true);
  });

  it("REPRO-COMPOSITE-PRE86: a complete composite with no persisted headline builds nothing, despite two csv rows", async () => {
    const row = strategyRow(
      analyticsRow({ data_quality_flags: { composite: true }, metrics_json_by_basis: null }),
    );
    seed(row, [
      { date: "2024-01-02", daily_return: 0.01 },
      { date: "2024-01-03", daily_return: -0.005 },
    ]);
    expect((row.strategy_analytics as Row).computation_status).toBe("complete");
    const payload = await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);
    expect(payload).toBeNull();
    expect(fake.tablesSeen).toContain("csv_daily_returns");
    expect(fake.orFilters.some((f) => f.includes(OWNER_ID))).toBe(true);
  });

  it("CONTROL-BUILDABLE: a complete single-key row with 30 dated returns builds, so the harness can build", async () => {
    seed(strategyRow(analyticsRow({ daily_returns: points(30) })));
    const payload = await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);
    expect(payload).not.toBeNull();
    expect(payload?.strategyId).toBe(STRATEGY_ID);
    expect(fake.orFilters.some((f) => f.includes(OWNER_ID))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SC2 / D-04 / D-07 — the probe and the builder decide from ONE resolve stage.
// ---------------------------------------------------------------------------

const FULL_CASH = {
  cumulative_return: 0.05,
  volatility: 0.12,
  max_drawdown: -0.04,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};

function csvRows(n: number): { date: string; daily_return: number }[] {
  return points(n).map((p) => ({ date: p.date, daily_return: p.value }));
}

/** A 31-point cumprod wealth curve, the shape the analytics service writes to returns_series. */
function wealthCurve(n: number): { date: string; value: number }[] {
  let w = 1;
  return points(n).map((p) => {
    w *= 1 + p.value;
    return { date: p.date, value: w };
  });
}

const composite = (over: Row) =>
  strategyRow(analyticsRow({ data_quality_flags: { composite: true }, ...over }));
const single = (over: Row) => strategyRow(analyticsRow(over));

const thirty = points(30);
const flatDict = Object.fromEntries(thirty.map((p) => [p.date, p.value]));
const nestedDict: Record<string, Record<string, number>> = {};
for (const p of thirty) {
  const [y, m, d] = p.date.split("-");
  (nestedDict[y] ??= {})[`${Number(m)}-${Number(d)}`] = p.value;
}

type Fixture = {
  name: string;
  row: Row | null;
  csv?: { date: string; daily_return: number }[];
  error?: unknown;
  /** The absolute expectation: null when a reason is named, else a payload. */
  reason: NotBuildableReason | null;
};

const PARITY: Fixture[] = [
  { name: "admin read error", row: null, error: { message: "synthetic outage", code: "XX000" }, reason: "read_error" },
  { name: "no row", row: null, reason: "not_visible" },
  { name: "status failed with a good series", row: single({ computation_status: "failed", daily_returns: thirty }), reason: "not_computed" },
  { name: "status computing", row: single({ computation_status: "computing", daily_returns: thirty }), reason: "not_computed" },
  { name: "composite, metrics_json_by_basis null", row: composite({ metrics_json_by_basis: null }), csv: csvRows(30), reason: "composite_unbuildable" },
  { name: "composite, valid headline, empty csv read", row: composite({ metrics_json_by_basis: { cash_settlement: FULL_CASH } }), csv: [], reason: "composite_unbuildable" },
  { name: "composite, valid headline, one csv row", row: composite({ metrics_json_by_basis: { cash_settlement: FULL_CASH } }), csv: csvRows(1), reason: "composite_unbuildable" },
  { name: "composite, valid headline, 30 csv rows", row: composite({ metrics_json_by_basis: { cash_settlement: FULL_CASH } }), csv: csvRows(30), reason: null },
  { name: "single-key, daily_returns and returns_series null", row: single({}), reason: "too_few_points" },
  { name: "single-key, one point", row: single({ daily_returns: [{ date: "2024-01-02", value: 0.01 }] }), reason: "too_few_points" },
  {
    name: "single-key, one point duplicated",
    row: single({ daily_returns: [{ date: "2024-01-02", value: 0.01 }, { date: "2024-01-02", value: 0.01 }] }),
    reason: "too_few_points",
  },
  {
    name: "single-key, one finite point plus one NaN",
    row: single({ daily_returns: [{ date: "2024-01-02", value: 0.01 }, { date: "2024-01-03", value: NaN }] }),
    reason: "too_few_points",
  },
  {
    name: "single-key, two good points",
    row: single({ daily_returns: [{ date: "2024-01-02", value: 0.01 }, { date: "2024-01-03", value: -0.02 }] }),
    reason: null,
  },
  { name: "single-key, 30 points as an array", row: single({ daily_returns: thirty }), reason: null },
  { name: "single-key, 30 points as a flat date dict", row: single({ daily_returns: flatDict }), reason: null },
  { name: "single-key, 30 points as a nested year dict", row: single({ daily_returns: nestedDict }), reason: null },
  { name: "single-key, returns_series-only equity curve", row: single({ returns_series: wealthCurve(31) }), reason: null },
];

describe("167.2.1 SC2 — probeFactsheetBuildable agrees with fetchAndBuildPayload on every fixture", () => {
  for (const f of PARITY) {
    it(`PARITY ${f.name}: ${f.reason ?? "buildable"}`, async () => {
      seed(f.row, f.csv ?? [], f.error ?? null);
      const payload = await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);

      seed(f.row, f.csv ?? [], f.error ?? null);
      fake.tablesSeen = [];
      fake.orFilters = [];
      const buildsBefore = vi.mocked(buildFactsheetPayload).mock.calls.length;
      const probe = await probeFactsheetBuildable(STRATEGY_ID, ownerVisibility);

      // The absolute expectation, so parity cannot pass with both sides wrong.
      if (f.reason === null) {
        expect(payload).not.toBeNull();
        expect(probe).toEqual({ buildable: true });
      } else {
        expect(payload).toBeNull();
        expect(probe).toEqual({ buildable: false, reason: f.reason });
      }
      // The invariant the probe's doc comment states.
      expect(probe.buildable).toBe(payload !== null);
      // The probe is the resolve stage and nothing else: no build, no basis reads.
      expect(vi.mocked(buildFactsheetPayload).mock.calls.length).toBe(buildsBefore);
      expect(fake.tablesSeen).not.toContain("strategy_analytics_series");
      // The visibility predicate is REQUIRED and reached the probe's query.
      expect(fake.orFilters.some((flt) => flt.includes(OWNER_ID))).toBe(true);
    });
  }

  it("NO-NULL-AFTER-RESOLVE: every fixture the probe calls buildable builds a payload", async () => {
    let okResolves = 0;
    for (const f of PARITY) {
      seed(f.row, f.csv ?? [], f.error ?? null);
      const probe = await probeFactsheetBuildable(STRATEGY_ID, ownerVisibility);
      if (!probe.buildable) continue;
      okResolves++;
      seed(f.row, f.csv ?? [], f.error ?? null);
      expect(await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility), f.name).not.toBeNull();
    }
    // The loop must have exercised the ok branch, or it proves nothing.
    expect(okResolves).toBe(PARITY.filter((f) => f.reason === null).length);
    expect(okResolves).toBeGreaterThan(0);
  });
});
