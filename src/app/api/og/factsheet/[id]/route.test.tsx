import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 147 / SCEN-01 — GET /api/og/factsheet/[id] (the dynamic OG card)
 *
 * FIRST test file for this route (Wave-0 gap). It existed untested since the
 * card was added, which is how bare reader #3 survived: the route read only
 * `strategy_analytics.daily_returns`, and the analytics-service leaves that
 * column NULL — it writes the cumprod EQUITY curve to `returns_series`. So
 * every social unfurl of a real (service-computed) strategy rendered the
 * blank card: name only, Sharpe / CAGR / Max DD all "—".
 *
 * Coverage matrix:
 *   O1  — SC1-OG wiring: a returns_series-ONLY analytics embed reaches
 *         computeOgHeadline as the DIFFERENCED series (N−1 rows), not [] and
 *         not the raw wealth index
 *   O1b — SC1-OG outcome: with a real-length track (≥ 30 obs spanning > 1
 *         calendar year) in returns_series ONLY, the headline metrics are
 *         FINITE and the card renders real numbers instead of "—". This is the
 *         assertion that fails on the pre-147 route
 *   O2  — a populated daily_returns still wins (resolver direct-first contract;
 *         the CSV-ingest path is byte-unchanged)
 *   O3  — both columns null → the fallback card, no throw, headline never
 *         computed
 *   O4  — the embed select carries returns_series, and the published-only gate
 *         is still applied (T-147-06 non-vacuity)
 *   O5  — the read THROWING still renders a card (the fail-soft discipline the
 *         route's own comment promises: a broken OG image must never 500)
 *
 * Mocking strategy (147-PATTERNS §"No Analog Found" — `next/og` has zero mock
 * precedent in this repo):
 *   - vi.mock("next/og") with a stub ImageResponse class that RECORDS its
 *     constructor args and exposes a real `Headers` so the route's
 *     Cache-Control set still works. No PNG is ever rendered under vitest.
 *   - vi.mock("@/lib/supabase/server") in the sync-progress harness style; the
 *     builder records the select string and every filter, so the published-only
 *     predicate (appended by the REAL withPublishedOnly) is observable.
 *   - computeOgHeadline is wrapped, NOT replaced: the spy records its input
 *     rows and then delegates to the REAL implementation, so the finiteness
 *     assertions are pinned against the true contract rather than a double
 *     (Oracle Independence, 147-VALIDATION.md).
 */

vi.mock("server-only", () => ({}));

const PUBLISHED_ID = "22222222-2222-4222-8222-222222222222";

const STATE = vi.hoisted(() => ({
  strategyRow: null as Record<string, unknown> | null,
  readError: null as { code: string; message: string } | null,
  /** When true, createClient() itself throws — the outer fail-soft arm. */
  clientThrows: false,
  observed: {
    select: null as string | null,
    filters: [] as Array<[string, unknown]>,
    tables: [] as string[],
  },
}));

/** Every ImageResponse the route constructed, newest last. */
const ogCalls = vi.hoisted(
  () => [] as Array<{ element: unknown; options: unknown }>,
);

vi.mock("next/og", () => ({
  ImageResponse: class {
    headers = new Headers();
    constructor(element: unknown, options?: unknown) {
      ogCalls.push({ element, options });
    }
  },
}));

/** (rows, assetClass, result) for every computeOgHeadline invocation. */
const headlineCalls = vi.hoisted(
  () =>
    [] as Array<{
      rows: ReadonlyArray<{ date: unknown; value: number }>;
      assetClass: string | null | undefined;
      result: { sharpe: number; cagr: number; maxDd: number };
    }>,
);

vi.mock("@/lib/factsheet/og-metrics", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/factsheet/og-metrics")>();
  return {
    ...actual,
    computeOgHeadline: (
      rows: ReadonlyArray<{ date: unknown; value: number }>,
      assetClass: string | null | undefined,
    ) => {
      const result = actual.computeOgHeadline(rows, assetClass);
      headlineCalls.push({ rows, assetClass, result });
      return result;
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (STATE.clientThrows) throw new Error("supabase client unavailable");
    return {
      from: (table: string) => {
        STATE.observed.tables.push(table);
        const builder = {
          select: (cols: string) => {
            STATE.observed.select = cols;
            return builder;
          },
          eq: (col: string, val: unknown) => {
            STATE.observed.filters.push([col, val]);
            return builder;
          },
          maybeSingle: async () => ({
            data: STATE.strategyRow,
            error: STATE.readError,
          }),
        };
        return builder;
      },
    };
  },
}));

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(): Request {
  return new Request(`http://localhost:3000/api/og/factsheet/${PUBLISHED_ID}`);
}

/**
 * Collect every string that appears anywhere in a React element tree — in
 * children OR in props (the headline numbers live on `<Stat value={…} />`,
 * which is never rendered because nothing renders the tree here).
 */
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
    return out;
  }
  if (node && typeof node === "object") {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props) {
      for (const value of Object.values(props)) collectStrings(value, out);
    }
  }
  return out;
}

/** The strings of the most recently constructed OG card. */
function latestCardStrings(): string[] {
  const last = ogCalls[ogCalls.length - 1];
  expect(last, "the route must always construct an ImageResponse").toBeTruthy();
  return collectStrings(last.element);
}

/**
 * The exact production shape of a service-computed strategy: `daily_returns`
 * NULL, the real track in `returns_series` as a cumprod WEALTH curve.
 * Differenced this is 3 returns: +0.05, −0.10, +0.10 (hand-computed literals,
 * never re-derived by calling the resolver inside this test).
 */
const WEALTH_INDEX = [
  { date: "2026-01-01", value: 1.0 },
  { date: "2026-01-02", value: 1.05 },
  { date: "2026-01-03", value: 0.945 },
  { date: "2026-01-04", value: 1.0395 },
];

/**
 * A real-length wealth curve: 400 calendar days from 2024-01-01, so the
 * differenced series clears BOTH headline gates (≥ 30 observations for Sharpe /
 * Max DD, and > 0.95 calendar years with positive cumulative growth for CAGR).
 * Deterministic by construction — a fixed drift plus a fixed oscillation, no
 * randomness — so the finiteness assertions can never flake.
 */
const LONG_WEALTH_INDEX = (() => {
  const out: Array<{ date: string; value: number }> = [];
  const start = Date.UTC(2024, 0, 1);
  let wealth = 1;
  for (let i = 0; i < 400; i++) {
    if (i > 0) wealth *= 1 + 0.0006 + 0.004 * Math.sin(i);
    out.push({
      date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
      value: wealth,
    });
  }
  return out;
})();

beforeEach(() => {
  STATE.strategyRow = {
    id: PUBLISHED_ID,
    name: "Helios Momentum",
    codename: null,
    description: "A test strategy",
    asset_class: "crypto",
    strategy_analytics: [{ daily_returns: null, returns_series: null }],
  };
  STATE.readError = null;
  STATE.clientThrows = false;
  STATE.observed = { select: null, filters: [], tables: [] };
  ogCalls.length = 0;
  headlineCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/og/factsheet/[id]", () => {
  it("O1 — SC1-OG: a returns_series-ONLY embed reaches computeOgHeadline as the DIFFERENCED series", async () => {
    STATE.strategyRow!.strategy_analytics = [
      { daily_returns: null, returns_series: WEALTH_INDEX },
    ];
    const { GET } = await import("./route");
    await GET(makeRequest(), ctx(PUBLISHED_ID));

    expect(headlineCalls).toHaveLength(1);
    const { rows } = headlineCalls[0];
    // Differencing consumes the first point: N wealth values → N−1 returns.
    // Pre-147 this was [] (the gate never fired) — never a hard-coded count.
    expect(rows).toHaveLength(WEALTH_INDEX.length - 1);
    expect(rows[0].value).toBeCloseTo(0.05, 10);
    expect(rows[1].value).toBeCloseTo(-0.1, 10);
    expect(rows[2].value).toBeCloseTo(0.1, 10);
    // The wealth LEVELS are never forwarded as if they were returns (a 1.0
    // level would read as a +100% day and inflate every headline metric).
    for (const r of rows) expect(Math.abs(r.value)).toBeLessThan(1.0);
    // The asset-class basis still reaches the metric helper (√365 crypto).
    expect(headlineCalls[0].assetClass).toBe("crypto");
  });

  it("O1c — PRODUCTION shape (no 1.0 base row): differencing yields N−1 returns; day-one's return is UNRECOVERABLE", async () => {
    // The analytics-service writer's first element is (1 + r_0) — it never
    // persists a 1.0 base row (metrics.py cumprod over the returns' own date
    // index; day-0-exclusion semantics). WEALTH_INDEX above is the anchored
    // test-convenience variant; this companion pins what production data
    // actually delivers: N stored points → N−1 returns, day one absent.
    const PROD_WEALTH_INDEX = WEALTH_INDEX.slice(1); // head 1.05 = (1 + 0.05)
    STATE.strategyRow!.strategy_analytics = [
      { daily_returns: null, returns_series: PROD_WEALTH_INDEX },
    ];
    const { GET } = await import("./route");
    await GET(makeRequest(), ctx(PUBLISHED_ID));

    expect(headlineCalls).toHaveLength(1);
    const { rows } = headlineCalls[0];
    expect(rows).toHaveLength(PROD_WEALTH_INDEX.length - 1);
    expect(rows[0].value).toBeCloseTo(-0.1, 10);
    expect(rows[1].value).toBeCloseTo(0.1, 10);
    // The +5% baked into the first stored element never surfaces as a return.
    for (const r of rows) expect(r.value).not.toBeCloseTo(0.05, 10);
  });

  it("O1b — SC1-OG outcome: a real-length returns_series-ONLY track renders FINITE headline metrics, not the blank card", async () => {
    STATE.strategyRow!.strategy_analytics = [
      { daily_returns: null, returns_series: LONG_WEALTH_INDEX },
    ];
    const { GET } = await import("./route");
    await GET(makeRequest(), ctx(PUBLISHED_ID));

    expect(headlineCalls).toHaveLength(1);
    const { sharpe, cagr, maxDd } = headlineCalls[0].result;
    // This is the founder-visible symptom: on the pre-147 route all three were
    // NaN for every service-computed strategy, so every unfurl showed "—".
    expect(Number.isFinite(sharpe)).toBe(true);
    expect(Number.isFinite(cagr)).toBe(true);
    expect(Number.isFinite(maxDd)).toBe(true);
    // A drawdown is a loss from peak: never positive.
    expect(maxDd).toBeLessThanOrEqual(0);

    // And the card itself carries real numbers rather than the "—" sentinel.
    const strings = latestCardStrings();
    expect(strings).toContain("Helios Momentum");
    expect(strings.filter(s => s === "—")).toHaveLength(0);
  });

  it("O2 — a populated daily_returns still wins over returns_series (direct-first contract)", async () => {
    const csvSeries = [
      { date: "2026-01-02", value: 0.001 },
      { date: "2026-01-03", value: -0.002 },
      { date: "2026-01-04", value: 0.003 },
    ];
    STATE.strategyRow!.strategy_analytics = [
      { daily_returns: csvSeries, returns_series: WEALTH_INDEX },
    ];
    const { GET } = await import("./route");
    await GET(makeRequest(), ctx(PUBLISHED_ID));

    expect(headlineCalls).toHaveLength(1);
    // The CSV column is used AS-IS: same length, same values — the equity
    // curve is never derived from when the cheap column is present.
    expect(headlineCalls[0].rows).toEqual(csvSeries);
  });

  it("O3 — both columns null → the fallback card, no throw, headline never computed", async () => {
    STATE.strategyRow!.strategy_analytics = [
      { daily_returns: null, returns_series: null },
    ];
    const { GET } = await import("./route");
    await expect(
      GET(makeRequest(), ctx(PUBLISHED_ID)),
    ).resolves.toBeDefined();

    // Nothing to compute from → the helper is not invoked at all, and the card
    // renders the name with "—" sentinels. Honest absence, never a fabricated 0.
    expect(headlineCalls).toHaveLength(0);
    const strings = latestCardStrings();
    expect(strings).toContain("Helios Momentum");
    expect(strings.filter(s => s === "—").length).toBeGreaterThanOrEqual(3);
    expect(strings).not.toContain("0.00");
  });

  it("O4 — the embed select carries returns_series and the published-only gate still applies (T-147-06)", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest(), ctx(PUBLISHED_ID));

    expect(STATE.observed.tables).toEqual(["strategies"]);
    expect(STATE.observed.select).toContain("returns_series");
    // The pre-147 columns stay (no accidental narrowing of the embed).
    expect(STATE.observed.select).toContain("daily_returns");
    expect(STATE.observed.select).toContain("asset_class");
    // Non-vacuity: this route is PUBLIC (anon unfurl traffic). withPublishedOnly
    // is unchanged, so returns_series is read for published rows only.
    expect(STATE.observed.filters).toContainEqual(["status", "published"]);
    expect(STATE.observed.filters).toContainEqual(["id", PUBLISHED_ID]);
  });

  it("O5 — a read that THROWS still renders a card (a broken OG image must never 500)", async () => {
    STATE.clientThrows = true;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    await expect(
      GET(makeRequest(), ctx(PUBLISHED_ID)),
    ).resolves.toBeDefined();
    // Fallback identity, not a crash — and the failure is logged, not silent.
    expect(latestCardStrings()).toContain("Strategy");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
