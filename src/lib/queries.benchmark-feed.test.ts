import { describe, it, expect, beforeEach, vi } from "vitest";
import { equityChartWidgetDataSchema } from "@/app/(dashboard)/allocations/widgets/lib/widget-data";

/**
 * Phase 169.4 plan 02 (SC3, D-09, D-69). The allocator dashboard payload
 * carries the database BTC closes the /allocations Overview builds its BTC
 * comparator from, read through 169.5's `readFactsheetBenchmark` over the
 * book's own dates.
 *
 * Why this matters: before this plan the Overview reached the factsheet
 * builder with no BTC opt, so its comparator was the bundled fixture, frozen
 * at the fixture's last date, while every factsheet read the fed table. These
 * cases pin the three states of the new field: ready (the fed closes, bounded
 * to the book), a read error (the unavailable form, never the fixture) and
 * rebuilding (null, with no read issued at all).
 *
 * The mock client is a small PostgREST builder: `benchmark_prices` honours
 * `.gte` / `.lte` / `.lt` / `.order` / `.limit` like the server, and every
 * read of that table is recorded so a case can assert the bounds and the
 * absence of a read.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  tableErrors: {} as Record<string, { message: string } | null>,
  benchCalls: [] as Array<{ ascending: boolean; gte?: string; lte?: string; lt?: string }>,
}));

function buildChain(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  const orders: Array<{ column: string; ascending: boolean }> = [];
  let limitN: number | null = null;
  let headCount = false;
  const benchCall: { ascending: boolean; gte?: string; lte?: string; lt?: string } = { ascending: true };

  function served(): Row[] {
    const rows = (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (orders.length > 0) {
      rows.sort((a, b) => {
        for (const o of orders) {
          const x = a[o.column] as string | number;
          const y = b[o.column] as string | number;
          if (x === y) continue;
          const c = x < y ? -1 : 1;
          return o.ascending ? c : -c;
        }
        return 0;
      });
    }
    return limitN === null ? rows : rows.slice(0, limitN);
  }

  function resolveList() {
    if (table === "benchmark_prices") state.benchCalls.push({ ...benchCall });
    const injected = state.tableErrors[table];
    if (injected) return { data: null, error: injected };
    if (headCount) return { data: null, error: null, count: served().length };
    return { data: served(), error: null };
  }

  const chain: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head === true) headCount = true;
      return chain;
    },
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
    in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), chain),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), chain),
    not: (c: string, op: string, v: unknown) => {
      if (op === "is") filters.push((r) => (r[c] ?? null) !== v);
      return chain;
    },
    gt: (c: string, v: string | number) => (filters.push((r) => (r[c] as string | number) > v), chain),
    gte: (c: string, v: string) => {
      benchCall.gte = v;
      filters.push((r) => (r[c] as string) >= v);
      return chain;
    },
    lte: (c: string, v: string) => {
      benchCall.lte = v;
      filters.push((r) => (r[c] as string) <= v);
      return chain;
    },
    lt: (c: string, v: string) => {
      benchCall.lt = v;
      filters.push((r) => (r[c] as string) < v);
      return chain;
    },
    order: (column: string, opts?: { ascending?: boolean }) => {
      const ascending = opts?.ascending !== false;
      orders.push({ column, ascending });
      if (orders.length === 1) benchCall.ascending = ascending;
      return chain;
    },
    limit: (n: number) => ((limitN = n), chain),
    maybeSingle: async () => {
      const injected = state.tableErrors[table];
      if (injected) return { data: null, error: injected };
      return { data: served()[0] ?? null, error: null };
    },
    single: async () => {
      const row = served()[0];
      return { data: row ?? null, error: row ? null : { message: "not found" } };
    },
    then: (resolve: (v: unknown) => void) => resolve(resolveList()),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => buildChain(table),
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => buildChain(table) }),
}));
vi.mock("next/server", async (importActual) => ({
  ...(await importActual<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn(() => Promise.resolve()) }));

// The book's last return is dated 2026-09-29 ("yesterday" relative to the
// fixed date these cases are written for). Fixed dates, never `new Date()`, so
// the cases are deterministic, and all after the bundled BTC fixture's last
// date (2026-05-12) so a fixture close can never stand in for a DB close.
const BOOK_RETURNS = [
  { date: "2026-09-27", r: 0.004 },
  { date: "2026-09-28", r: -0.002 },
  { date: "2026-09-29", r: 0.003 },
];
const BOOK_CURVE = [
  { date: "2026-09-26", equity_usd: 100_000 },
  { date: "2026-09-27", equity_usd: 100_400 },
  { date: "2026-09-28", equity_usd: 100_199.2 },
  { date: "2026-09-29", equity_usd: 100_499.8 },
];

/** BTC closes stored for every day of September 2026 up to 2026-09-29. */
const DB_BTC_ROWS = Array.from({ length: 29 }, (_, i) => ({
  symbol: "BTC",
  date: `2026-09-${String(i + 1).padStart(2, "0")}`,
  close_price: 60_000 + i * 100,
}));

function seedReadyBook() {
  state.tables.portfolios = [
    {
      id: "real-1",
      user_id: "user-1",
      name: "Active Allocation",
      description: null,
      created_at: "2024-06-01T00:00:00Z",
      is_test: false,
    },
  ];
  state.tables.api_keys = [
    {
      id: "k-holder",
      user_id: "user-1",
      exchange: "binance",
      label: "Binance main",
      is_active: true,
      sync_status: "ok",
      last_sync_at: new Date().toISOString(),
      disconnected_at: null,
      account_balance_usdt: 1000,
      created_at: "2026-04-01T00:00:00Z",
      venue_account_id: "acct-synthetic-1",
      account_share_kind: null,
      account_shared_with_api_key_id: null,
    },
  ];
  state.tables.allocator_equity_derived = [
    {
      allocator_id: "user-1",
      kind: "equity_curve",
      payload: {
        version: 2,
        curve: BOOK_CURVE,
        returns: BOOK_RETURNS,
        flags: [],
        degrade_reasons: [],
        is_trustworthy: true,
        scalars: { mwr: 0.01, dietz: 0.01, computable: true },
        inputs: { n_keys: 1, anchor_asof: "2026-09-29", composed_at: "2026-09-29T00:00:00Z" },
      },
    },
  ];
  state.tables.benchmark_prices = DB_BTC_ROWS.map((r) => ({ ...r }));
}

async function load() {
  const mod = await import("./queries");
  mod.__resetDerivedRowCaptureThrottleForTests();
  return mod;
}

beforeEach(() => {
  state.tables = {};
  state.tableErrors = {};
  state.benchCalls = [];
  vi.restoreAllMocks();
});

/** The ready payload `getMyAllocationDashboard` returns under this file's mocked client. */
async function readyDashboardPayload() {
  seedReadyBook();
  const { getMyAllocationDashboard } = await load();
  return getMyAllocationDashboard("user-1");
}

describe("getMyAllocationDashboard — the BTC feed the Overview comparator reads (169.4-02, D-69)", () => {
  it("ready book: btcBenchmarkPrices is the DB closes bounded to [first book date - 1 day, last book date], through the last book date", async () => {
    const result = await readyDashboardPayload();

    expect(result.equityHistoryState).toBe("ready");
    expect(result.btcBenchmarkPrices).toEqual({
      prices: [
        { date: "2026-09-26", close: 62_500 },
        { date: "2026-09-27", close: 62_600 },
        { date: "2026-09-28", close: 62_700 },
        { date: "2026-09-29", close: 62_800 },
      ],
      through: "2026-09-29",
      dropped: [],
    });
    // The price read (descending) is bounded exactly as readFactsheetBenchmark
    // computes from the book's own returns; the one-row probe is ascending.
    const reads = state.benchCalls.filter((c) => !c.ascending);
    expect(reads.length).toBeGreaterThan(0);
    for (const c of reads) {
      expect(c.gte).toBe("2026-09-26");
      expect(c.lte).toBe("2026-09-29");
    }
  });

  it("a benchmark read error is the unavailable form, never fixture closes", async () => {
    seedReadyBook();
    state.tableErrors.benchmark_prices = { message: "simulated benchmark_prices failure" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getMyAllocationDashboard } = await load();

    const result = await getMyAllocationDashboard("user-1");

    expect(result.equityHistoryState).toBe("ready");
    expect(result.btcBenchmarkPrices).toEqual({ unavailable: true });
    expect(errSpy).toHaveBeenCalled();
  });

  it("rebuilding book: btcBenchmarkPrices is null and no benchmark_prices query is issued", async () => {
    seedReadyBook();
    // A second key reading the same exchange account through the working
    // holder is a duplicate: the history is rebuilding, whatever the row says.
    (state.tables.api_keys as Row[]).push({
      ...(state.tables.api_keys as Row[])[0],
      id: "k-dup",
      label: "Binance dup",
      account_share_kind: "duplicate",
      account_shared_with_api_key_id: "k-holder",
    });
    const { getMyAllocationDashboard } = await load();

    const result = await getMyAllocationDashboard("user-1");

    expect(result.equityHistoryState).toBe("rebuilding");
    expect(result.btcBenchmarkPrices).toBeNull();
    expect(state.benchCalls).toEqual([]);
  });

  it("the no-portfolio branch carries the same field (both return objects spread one producer)", async () => {
    seedReadyBook();
    state.tables.portfolios = [];
    const { getMyAllocationDashboard } = await load();

    const result = await getMyAllocationDashboard("user-1");

    expect(result.portfolio).toBeNull();
    expect(result.equityHistoryState).toBe("ready");
    expect(result.btcBenchmarkPrices).toMatchObject({ through: "2026-09-29" });
  });

  // Key-collision pin, producer half (plan-check round 1, blocker 1). The
  // Overview mounts EquityChartWidget with the WHOLE payload, and that widget's
  // schema already types a `btcBenchmark` key as an array of daily points with
  // onInvalid "empty". The ready payload must still parse, or every ready
  // Overview's equity curve renders "Equity data warming up".
  it("the ready payload still satisfies the equity chart's schema", async () => {
    const result = await readyDashboardPayload();
    // The collision assertion first, so a renamed key fails HERE, on the schema.
    expect(equityChartWidgetDataSchema.safeParse(result).success).toBe(true);
    expect(result.btcBenchmarkPrices).toMatchObject({ through: "2026-09-29" });
  });
});
