/**
 * Phase 169.1 plan 01 (D-23 as amended 2026-09-25, D-25, D-26, D-81; 167.2.1
 * D-04 / D-09): the discovery detail page builds its factsheet through the ONE
 * shared resolve-and-build, `fetchAndBuildPayloadWithReason`.
 *
 * WHY. The page used to assemble the builder itself: its own series
 * resolution, its own composite and single-key branches, its own BTC read and
 * its own builder call. That was a second copy of the factsheet route's
 * assembly, kept in step only by a lockstep test, and the founder principle
 * D-25 is "calculate Sharpe once; every page reads it". A second copy is how
 * the discovery page and the factsheet route came to show different numbers
 * for the same strategy. These cases pin the one path from three sides:
 *
 *   1. PAYLOAD: on a buildable row the page's FactsheetView payload deep-equals
 *      the shared path's payload with the trust tier overlaid, as the v2 page
 *      overlays it (D-26). Any field the page computed itself would differ.
 *   2. PROBE PARITY (167.2.1 D-04): on every fixture the page renders the
 *      factsheet iff `probeFactsheetBuildable` answers buildable. A page that
 *      gated on anything else would show a factsheet the probe calls
 *      unbuildable, or the reverse, and the owner would be told one thing while
 *      the allocator sees another.
 *   3. FALLBACK (D-81): a series-read OUTAGE says the load failed and is
 *      captured exactly once (by the resolve stage); every other unbuildable
 *      row says the one KCS-10 sentence and raises no read_error event.
 *
 * The admin client is faked at the table level (the 167.2.1 parity-table
 * shape in `src/lib/factsheet/fetch-and-build-payload.test.ts`), so the REAL
 * shared path, the REAL probe and the REAL visibility helpers run. The page
 * and the probe are driven from the SAME fixture.
 *
 * The expected sentences are HAND-TYPED, never imported: an import would make
 * the oracle agree with whatever the module says.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ getStrategyDetail: vi.fn() }));

type Row = Record<string, unknown>;

const fake = vi.hoisted(() => ({
  strategyResult: { data: null as unknown, error: null as unknown },
  csvRows: [] as { date: string; daily_return: number }[],
  csvError: null as unknown,
  seriesError: null as unknown,
  tablesSeen: [] as string[],
  /** Every `.eq(column, value)` the `strategies` read received. */
  strategyEqs: [] as [string, unknown][],
  /** Every `.or(filter)` the `strategies` read received. */
  strategyOrs: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self;
    b.order = self;
    b.limit = self;
    b.abortSignal = self;
    b.eq = (column: string, value: unknown) => {
      if (table === "strategies") fake.strategyEqs.push([column, value]);
      return b;
    };
    b.or = (filter: string) => {
      if (table === "strategies") fake.strategyOrs.push(filter);
      return b;
    };
    b.maybeSingle = async () => {
      if (table === "strategies") return fake.strategyResult;
      if (table === "strategy_analytics_series" && fake.seriesError) {
        return { data: null, error: fake.seriesError };
      }
      return { data: null, error: null };
    };
    if (table === "benchmark_prices") {
      // An empty successful page: no stored BTC history, so the BTC block is
      // the unavailable form on both sides of every comparison.
      b.gte = self;
      b.lte = self;
      b.lt = self;
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    }
    if (table === "csv_daily_returns") {
      // The composite reader pages by a date keyset and stops on an empty page.
      let after: string | null = null;
      b.gt = (_column: string, value: string) => {
        after = value;
        return b;
      };
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve(
          fake.csvError
            ? { data: null, error: fake.csvError }
            : { data: fake.csvRows.filter((r) => after === null || r.date > after), error: null },
        );
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

import StrategyDetailPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { getStrategyDetail } from "@/lib/queries";
import { captureToSentry } from "@/lib/sentry-capture";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { withPublishedOnly } from "@/lib/visibility";
import {
  fetchAndBuildPayload,
  probeFactsheetBuildable,
} from "@/lib/factsheet/fetch-and-build-payload";

// Synthetic, UUID-shaped ids: `withPublishedOrOwner` falls back to the
// published-only predicate on a non-UUID, which would hide an owner-inclusive
// predicate swapped into the page. A UUID viewer makes that swap visible.
const VIEWER_ID = "00000000-0000-4000-8000-0000000000c3";
const STRATEGY_ID = "00000000-0000-4000-8000-0000000000d4";
const SLUG = DISCOVERY_CATEGORIES[0]!.slug;

/** Hand-typed from 167.2-UI-SPEC.md § KCS-10. */
const KCS10_PUBLIC = "The detailed factsheet for this strategy is not available yet.";
/** Hand-typed (169-REVIEW-SFH H-3): an outage is not a row that is "not available yet". */
const READ_FAILED =
  "We could not load this strategy's factsheet right now. Reload this page to try again.";

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

const FULL_CASH = {
  cumulative_return: 0.05,
  volatility: 0.12,
  max_drawdown: -0.04,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};

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

/** The admin read's row: the strategy columns plus its analytics embed. */
function strategyRow(analytics: Row): Row {
  return {
    id: STRATEGY_ID,
    name: "Synthetic One-Path Fixture",
    codename: null,
    disclosure_tier: "exploratory",
    status: "published",
    markets: ["BTC"],
    strategy_types: ["trend"],
    description: null,
    subtypes: [],
    supported_exchanges: ["binance"],
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

type Fixture = {
  name: string;
  row: Row;
  csv?: { date: string; daily_return: number }[];
  csvError?: unknown;
  seriesError?: unknown;
  /** What the page must show: the factsheet, the read-failure line, or KCS-10. */
  shows: "factsheet" | "read_failed" | "kcs10";
};

const OUTAGE = { message: "synthetic statement timeout", code: "57014" };

const FIXTURES: Fixture[] = [
  {
    name: "CONTROL-BUILDABLE: complete single-key row with 30 dated returns",
    row: strategyRow(analyticsRow({ daily_returns: points(30) })),
    shows: "factsheet",
  },
  {
    name: "REPRO-SINGLE-ONE-POINT: complete single-key row with one dated return",
    row: strategyRow(analyticsRow({ daily_returns: [{ date: "2024-01-02", value: 0.01 }] })),
    shows: "kcs10",
  },
  {
    name: "REPRO-COMPOSITE-PRE86: complete composite with no persisted headline",
    row: strategyRow(analyticsRow({ data_quality_flags: { composite: true }, metrics_json_by_basis: null })),
    csv: [
      { date: "2024-01-02", daily_return: 0.01 },
      { date: "2024-01-03", daily_return: -0.005 },
    ],
    shows: "kcs10",
  },
  {
    // STALE-01: a failed latest computation leaves the previous run's series in
    // place. The shared G1 gate refuses it; no finished run vouches for it.
    name: "STALE: computation failed, previous run's 30-point series still present",
    row: strategyRow(analyticsRow({ computation_status: "failed", daily_returns: points(30) })),
    shows: "kcs10",
  },
  {
    name: "OUTAGE-COMPOSITE: composite with a valid headline whose csv_daily_returns read fails",
    row: strategyRow(
      analyticsRow({ data_quality_flags: { composite: true }, metrics_json_by_basis: { cash_settlement: FULL_CASH } }),
    ),
    csvError: OUTAGE,
    shows: "read_failed",
  },
  {
    name: "OUTAGE-SINGLE-MTM: single-key options row whose gated MTM series read fails",
    row: strategyRow(
      analyticsRow({ daily_returns: points(30), metrics_json_by_basis: { mark_to_market: { cumulative_return: 0.01 } } }),
    ),
    seriesError: OUTAGE,
    shows: "read_failed",
  },
];

function seed(f: Fixture) {
  fake.strategyResult = { data: f.row, error: null };
  fake.csvRows = f.csv ?? [];
  fake.csvError = f.csvError ?? null;
  fake.seriesError = f.seriesError ?? null;
  fake.tablesSeen = [];
  fake.strategyEqs = [];
  fake.strategyOrs = [];
}

/**
 * The page's own header read. It is seeded with the analytics row UNSHAPED, as
 * the removed "discovery" projection carried it, so a page that still built
 * from this read would have every input it needs: what fails it is that it is
 * not the shared path.
 */
function seedDetail(f: Fixture) {
  const { strategy_analytics, ...strategy } = f.row;
  vi.mocked(getStrategyDetail).mockResolvedValue({
    strategy: { ...strategy, trust_tier: "api_verified" },
    analytics: strategy_analytics,
    disclosureTier: "exploratory",
  } as never);
}

/** Every string rendered anywhere in an RSC element tree, concatenated. */
function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const el = node as { props?: { children?: unknown } };
  return textOf(el.props?.children ?? null);
}

/** The FactsheetView element's payload prop, or null when the fallback rendered. */
function findPayload(node: unknown): Record<string, unknown> | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPayload(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { props?: { payload?: unknown; children?: unknown } };
  if (el.props?.payload != null) return el.props.payload as Record<string, unknown>;
  return findPayload(el.props?.children ?? null);
}

async function renderPage() {
  return StrategyDetailPage({ params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }) });
}

beforeEach(() => {
  vi.mocked(captureToSentry).mockClear();
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: VIEWER_ID } } }) },
  } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("169.1-01 one path: the discovery page's payload IS the shared path's payload (D-23, D-26)", () => {
  it("ONE-PATH PAYLOAD: on a buildable row the page shows fetchAndBuildPayload's payload with the trust tier overlaid", async () => {
    const f = FIXTURES[0]!;
    seed(f);
    seedDetail(f);
    const page = findPayload(await renderPage());

    // The page read the strategy row through the shared path's admin read
    // exactly once, under the published-only predicate (T-169-39): never an
    // owner-inclusive one, even for a signed-in viewer.
    expect(fake.tablesSeen.filter((t) => t === "strategies")).toHaveLength(1);
    expect(fake.strategyEqs).toContainEqual(["status", "published"]);
    expect(fake.strategyOrs).toEqual([]);

    seed(f);
    const shared = await fetchAndBuildPayload(STRATEGY_ID, withPublishedOnly);
    expect(shared).not.toBeNull();
    expect(page).toEqual({ ...shared, trustTier: "api_verified" });
  });

  it("TRUST TIER: a strategy with no published verification signal shows no tier", async () => {
    const f = FIXTURES[0]!;
    seed(f);
    const { strategy_analytics, ...strategy } = f.row;
    vi.mocked(getStrategyDetail).mockResolvedValue({
      strategy: { ...strategy, trust_tier: null },
      analytics: strategy_analytics,
      disclosureTier: "exploratory",
    } as never);
    const page = findPayload(await renderPage());
    expect(page).not.toBeNull();
    expect(page!.trustTier).toBeNull();
  });
});

describe("169.1-01 probe parity: the page renders the factsheet iff probeFactsheetBuildable says buildable (167.2.1 D-04, D-81)", () => {
  for (const f of FIXTURES) {
    it(`PARITY ${f.name}: ${f.shows}`, async () => {
      seed(f);
      seedDetail(f);
      const jsx = await renderPage();
      const rendered = findPayload(jsx) !== null;
      const text = textOf(jsx);
      const captures = vi.mocked(captureToSentry).mock.calls.length;
      const readErrorCaptures = vi
        .mocked(captureToSentry)
        .mock.calls.filter(([, opts]) => (opts?.tags as { reason?: unknown } | undefined)?.reason === "read_error").length;

      seed(f);
      const probe = await probeFactsheetBuildable(STRATEGY_ID, withPublishedOnly);

      // The absolute expectation, so parity cannot pass with both sides wrong.
      expect(rendered).toBe(f.shows === "factsheet");
      // The invariant.
      expect(probe.buildable).toBe(rendered);

      if (f.shows === "read_failed") {
        expect(probe).toMatchObject({ buildable: false, reason: "read_error" });
        expect(text).toContain(READ_FAILED);
        expect(text).not.toContain(KCS10_PUBLIC);
        // Captured once, by the resolve stage. A second capture on the page
        // would send two events per outage (D-81).
        expect(captures).toBe(1);
        expect(readErrorCaptures).toBe(1);
      } else if (f.shows === "kcs10") {
        expect(probe.buildable).toBe(false);
        expect(text).toContain(KCS10_PUBLIC);
        expect(text).not.toContain(READ_FAILED);
        // A row that cannot build is a fact about the row, not an outage: no
        // read_error event. (The shared resolve stage still records a
        // composite that cannot build at level warning, 167.2.1 SFH H-1, as it
        // does on every other lane; that is not an outage alert.)
        expect(readErrorCaptures).toBe(0);
      } else {
        expect(text).not.toContain(KCS10_PUBLIC);
        expect(text).not.toContain(READ_FAILED);
      }
    });
  }
});
