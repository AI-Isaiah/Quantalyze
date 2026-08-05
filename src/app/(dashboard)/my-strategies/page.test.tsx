/**
 * Phase 149 / Plan 149-04 / NAV-01 — the /my-strategies RSC page spec.
 *
 * Written RED-FIRST (the page module does not exist yet).
 *
 * WHY A CHAIN-RECORDING SUPABASE DOUBLE (148 Pitfall-5 lesson): an identity
 * stub makes every predicate assertion VACUOUS — the test would pass with the
 * owner scope deleted. This double records `.from(table).select(cols)` plus
 * every `.eq()` / `.neq()` pair, so `.eq("user_id", <session id>)` and
 * `.neq("status", "archived")` are ASSERTABLE literals rather than hopes.
 * `.neq` is recorded alongside `.eq` deliberately: the W-4 archived exclusion
 * lives on the neq arm and would otherwise be unobservable.
 *
 * WHY PAYLOADS ROUTE BY QUERY SHAPE, NOT CALL ORDER (checker I-3): the page
 * issues three `strategies` reads with three different projections, two of them
 * inside a `Promise.all` whose settle order is not contractual. Routing on the
 * select shape (`*, strategy_analytics (*)` = own rows · `id, api_key_id,
 * status` = the coverage anti-join's lite read · `id, strategy_analytics (…)` =
 * the PERCENTILE_ANALYTICS_COLUMNS population) makes the fixtures stable under
 * any interleaving, and it is what lets the I-2 single-fetch pin below count
 * population-shaped queries at all.
 *
 * `useDiscoveryPrefs` needs NO mock — it is localStorage-only and jsdom
 * provides it. `categorySlug="my-strategies"` is a prefs-SCOPE key, not a
 * category, and cannot collide with the `discovery_view_preferences:u-1:
 * crypto-sma` CI-flake key StrategyTable.test.tsx documents.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

// ---------------------------------------------------------------------------
// Copy literals — 149-UI-SPEC Copywriting Contract, VERBATIM.
// Pinned as constants so a stray re-word in the implementation reddens here.
// ---------------------------------------------------------------------------
const mapCopy = (n: number) =>
  `Ranked against ${n} published strategies. # is the row's position in this list; Pnn compares the row against those ${n} published strategies. Private and draft rows are visible only to you and do not affect public rankings.`;
const NULL_COPY =
  "Percentile ranks appear once 5 strategies are published in the comparison set. Private and draft rows are visible only to you.";
const kSentence = (k: number) => `${k} of your keys have no strategy yet.`;
const EMPTY_HEADING = "No strategies yet.";
const EMPTY_BODY =
  "Connect an exchange API key or upload a CSV to see your strategies ranked here. First metrics arrive ~10–15 minutes after a key connects.";

const USER_ID = "49f9c0aa-0000-4000-8000-0000000000aa";

// ---------------------------------------------------------------------------
// The chain-recording supabase double
// ---------------------------------------------------------------------------

type Recorded = {
  table: string;
  select: string;
  eq: [string, unknown][];
  neq: [string, unknown][];
};

type Fixtures = {
  /** Raw `strategies` rows for the `*, strategy_analytics (*)` own-rows read. */
  ownRows: Record<string, unknown>[];
  /** Raw `strategies` rows for the published-universe percentile read. */
  population: Record<string, unknown>[];
  apiKeys: Record<string, unknown>[];
  strategyKeys: Record<string, unknown>[];
  portfolio: Record<string, unknown> | null;
  /**
   * WR-01 — per-read transient-failure switches, routed by the SAME query
   * shapes as the payloads so a failure hits exactly one fetcher.
   */
  errors: { ownRows?: boolean; apiKeys?: boolean };
};

const recorded: Recorded[] = [];
let fixtures: Fixtures;

/** Is this the PERCENTILE_ANALYTICS_COLUMNS population projection? */
const isPopulationShape = (r: Recorded) =>
  r.table === "strategies" && /^id,\s*strategy_analytics \(/.test(r.select);
/** Is this the `getMyStrategies` own-rows projection? */
const isOwnRowsShape = (r: Recorded) =>
  r.table === "strategies" && r.select.startsWith("*, strategy_analytics");

type Payload = { data: unknown; error: { message: string } | null };
const TRANSIENT_FAILURE: Payload = {
  data: null,
  error: { message: "transient failure" },
};

function resolvePayload(rec: Recorded): Payload {
  if (rec.table === "api_keys") {
    if (fixtures.errors.apiKeys) return TRANSIENT_FAILURE;
    return { data: fixtures.apiKeys, error: null };
  }
  if (rec.table === "strategy_keys")
    return { data: fixtures.strategyKeys, error: null };
  if (rec.table === "portfolios")
    return { data: fixtures.portfolio, error: null };
  if (rec.table === "strategies") {
    if (isOwnRowsShape(rec)) {
      if (fixtures.errors.ownRows) return TRANSIENT_FAILURE;
      return { data: fixtures.ownRows, error: null };
    }
    if (isPopulationShape(rec)) return { data: fixtures.population, error: null };
    // `id, api_key_id, status` — the coverage anti-join's lite own read.
    return {
      data: fixtures.ownRows.map((s) => ({
        id: s.id,
        api_key_id: s.api_key_id ?? null,
        status: s.status,
      })),
      error: null,
    };
  }
  return { data: [], error: null };
}

type Builder = {
  select: (cols: string) => Builder;
  eq: (col: string, val: unknown) => Builder;
  neq: (col: string, val: unknown) => Builder;
  maybeSingle: () => Promise<Payload>;
  then: (
    onFulfilled?: (v: Payload) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise<unknown>;
};

function makeBuilder(table: string): Builder {
  const rec: Recorded = { table, select: "", eq: [], neq: [] };
  recorded.push(rec);
  const builder: Builder = {
    select(cols) {
      rec.select = cols;
      return builder;
    },
    eq(col, val) {
      rec.eq.push([col, val]);
      return builder;
    },
    neq(col, val) {
      rec.neq.push([col, val]);
      return builder;
    },
    maybeSingle: async () => resolvePayload(rec),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(resolvePayload(rec)).then(onFulfilled, onRejected),
  };
  return builder;
}

const MOCK_USER = { id: USER_ID, email: "owner@quantalyze.test" };

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: MOCK_USER }, error: null })),
    },
    from: (table: string) => makeBuilder(table),
    // readPublicVerificationSignals reads the published-gated RPC; an empty
    // result means every row carries trust_tier null, which is exactly what an
    // owner's unpublished rows carry in production.
    rpc: vi.fn(async () => ({ data: [], error: null })),
  })),
}));

const noStoreSpy = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ unstable_noStore: noStoreSpy }));

const requireRoleSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/requireRolePage", () => ({
  // Pass-through spy: the page must CONTINUE past the guard so the render
  // assertions below are reachable. The wiring pin (the exact `need` literal
  // for every guarded surface) lives in requireRolePage-wiring.test.tsx.
  requireRolePage: async (...args: unknown[]) => {
    requireRoleSpy(...args);
  },
}));

const redirectSpy = vi.hoisted(() => vi.fn());
const routerRefreshSpy = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: redirectSpy,
  usePathname: () => "/my-strategies",
  useRouter: () => ({ refresh: routerRefreshSpy, push: vi.fn() }),
}));

// Leaf stubs (I-3) — the StrategyTable.test.tsx idiom. Neither has any bearing
// on the predicates, the copy or the Pnn suffix under test.
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));
vi.mock("@/components/charts/Sparkline", () => ({
  Sparkline: () => null,
}));

// ---------------------------------------------------------------------------
// Fixture factories — RAW `strategies` rows (pre-shaper), not view models.
// ---------------------------------------------------------------------------

function analyticsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "an",
    strategy_id: "s",
    computed_at: "2026-01-01T00:00:00Z",
    computing_started_at: null,
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.4,
    cagr: 0.18,
    volatility: 0.22,
    sharpe: 1.5,
    sortino: 1.9,
    calmar: 1.1,
    max_drawdown: -0.12,
    max_drawdown_duration_days: 30,
    six_month_return: 0.2,
    sparkline_returns: null,
    sparkline_drawdown: null,
    metrics_json: null,
    returns_series: null,
    drawdown_series: null,
    monthly_returns: null,
    daily_returns: null,
    rolling_metrics: null,
    return_quantiles: null,
    trade_metrics: null,
    volume_metrics: null,
    exposure_metrics: null,
    data_quality_flags: null,
    ...overrides,
  };
}

function dbStrategy(
  id: string,
  name: string,
  status: string,
  analytics: Record<string, unknown> = {},
) {
  return {
    id,
    user_id: USER_ID,
    name,
    category_id: null,
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Bybit"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status,
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    strategy_analytics: [analyticsRow({ strategy_id: id, ...analytics })],
  };
}

/** A published-universe row carrying only the percentile projection. */
function populationRow(id: string, sharpe: number) {
  return {
    id,
    strategy_analytics: [
      {
        cagr: sharpe / 10,
        sharpe,
        sortino: sharpe,
        calmar: sharpe,
        max_drawdown: -0.1,
        volatility: 0.2,
        cumulative_return: sharpe / 5,
      },
    ],
  };
}

function activeKey(id: string, exchange: string, label: string) {
  return {
    id,
    exchange,
    label,
    is_active: true,
    sync_status: "success",
    disconnected_at: null,
  };
}

function setFixtures(partial: Partial<Fixtures>) {
  fixtures = {
    ownRows: [],
    population: [],
    apiKeys: [],
    strategyKeys: [],
    portfolio: { id: "port-1", user_id: USER_ID, is_test: false },
    errors: {},
    ...partial,
  };
}

async function renderPage() {
  const mod = await import("./page");
  const ui = await (mod.default as () => Promise<React.ReactElement>)();
  return render(ui);
}

beforeEach(() => {
  installFetchMock();
  recorded.length = 0;
  noStoreSpy.mockClear();
  requireRoleSpy.mockClear();
  redirectSpy.mockClear();
  setFixtures({});
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
});

afterEach(() => {
  restoreFetchMock();
});

// ---------------------------------------------------------------------------

describe("SC-1b — the owner-scoped predicates reach supabase", () => {
  it("scopes the ranked read to the SESSION user, excludes archived, and never names a published predicate", async () => {
    setFixtures({
      ownRows: [dbStrategy("s-1", "Nebula One", "private")],
      population: Array.from({ length: 7 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
      apiKeys: [activeKey("k-1", "bybit", "Bybit Main")],
    });

    await renderPage();

    const ownRead = recorded.find(isOwnRowsShape);
    expect(ownRead).toBeDefined();
    // T-149-11: the owner id is the SESSION id — the page takes no params, so
    // there is no other id it could possibly have used.
    expect(ownRead!.eq).toContainEqual(["user_id", USER_ID]);
    // W-4: archived rows are excluded from the ranked list.
    expect(ownRead!.neq).toContainEqual(["status", "archived"]);
    // The own read must NOT be published-gated — that is the whole point of the
    // surface. (The population read below IS, and is asserted separately.)
    expect(ownRead!.eq).not.toContainEqual(["status", "published"]);

    const keysRead = recorded.find((r) => r.table === "api_keys");
    expect(keysRead?.eq).toContainEqual(["user_id", USER_ID]);
    const linksRead = recorded.find((r) => r.table === "strategy_keys");
    expect(linksRead?.eq).toContainEqual(["owner_id", USER_ID]);
  });
});

describe("SC-2c — the comparison-set line states the REAL N", () => {
  it("map branch: N is the published population size, with the #n/Pnn disambiguation", async () => {
    setFixtures({
      ownRows: [
        dbStrategy("s-1", "Nebula One", "private"),
        dbStrategy("s-2", "Quasar Two", "draft"),
        dbStrategy("s-3", "Pulsar Three", "published"),
      ],
      population: Array.from({ length: 7 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
    });

    await renderPage();

    const note = screen.getByTestId("comparison-set-note");
    expect(note.textContent).toContain("Ranked against 7 published strategies");
    expect(note.textContent).toBe(mapCopy(7));

    // I-2 single-fetch pin: the published universe is fetched EXACTLY ONCE on
    // this page. A second identical fetch (e.g. a re-introduced getPercentiles
    // call for the N) is a regression, not an optimisation opportunity.
    expect(recorded.filter(isPopulationShape)).toHaveLength(1);
    // ...and that one read IS published-gated (withPublishedOnly), so N can
    // never count an unpublished row.
    expect(recorded.find(isPopulationShape)!.eq).toContainEqual([
      "status",
      "published",
    ]);
  });

  it("null branch: a population under 5 switches to the threshold copy", async () => {
    setFixtures({
      ownRows: [dbStrategy("s-1", "Nebula One", "private")],
      population: Array.from({ length: 4 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
    });

    await renderPage();

    const note = screen.getByTestId("comparison-set-note");
    expect(note.textContent).toContain(
      "Percentile ranks appear once 5 strategies are published",
    );
    expect(note.textContent).toBe(NULL_COPY);
    expect(note.textContent).not.toContain("Ranked against");
  });
});

describe("SC-2d — own rows carry a Pnn scored against the PUBLISHED population", () => {
  it("renders the own-scored suffix on a DRAFT row (the founder scorer ruling, wired)", async () => {
    // Population sharpe = [1..7]. Neither own row is in it (both unpublished),
    // so each is scored SELF-INCLUSIVELY (W-A) against population ∪ {subject}:
    //   sharpe 3.5 → effective [1,2,3,3.5,4,5,6,7], 4 of 8 values ≤ 3.5 → P50
    //   sharpe 7.5 → effective [1..7,7.5],          8 of 8 values ≤ 7.5 → 100
    // The raw 100 renders as `P99`: StrategyTable clamps the suffix to 1..99
    // (the pre-existing "P0/P100 are edge artifacts" rule shared with
    // /discovery). Parity forbids changing that here, so the fixture asserts
    // the CLAMPED literal; the unclamped P50 case is the load-bearing proof
    // that the OWN map — not the published map, which contains neither id —
    // reached the rendered row.
    setFixtures({
      ownRows: [
        dbStrategy("s-mid", "Mid Draft", "draft", { sharpe: 3.5 }),
        dbStrategy("s-top", "Top Draft", "draft", { sharpe: 7.5 }),
      ],
      population: Array.from({ length: 7 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
    });

    await renderPage();

    // Default sort is `sharpe`, which is the ACTIVE column the suffix renders on.
    expect(screen.getByText("P50")).toBeInTheDocument();
    expect(screen.getByText("P99")).toBeInTheDocument();
    // ONE population fetch served BOTH the N copy and these suffixes.
    expect(recorded.filter(isPopulationShape)).toHaveLength(1);
    expect(
      screen.getByTestId("comparison-set-note").textContent,
    ).toBe(mapCopy(7));
  });
});

describe("the K sentence (Delta 5 coverage copy)", () => {
  it("appends the bare-key count when K > 0", async () => {
    setFixtures({
      ownRows: [dbStrategy("s-1", "Nebula One", "private")],
      population: Array.from({ length: 7 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
      apiKeys: [
        activeKey("k-1", "bybit", "Bybit Main"),
        activeKey("k-2", "deribit", "Deribit Options"),
      ],
    });

    await renderPage();

    const note = screen.getByTestId("comparison-set-note");
    expect(note.textContent).toContain(kSentence(2));
    expect(note.textContent).toBe(`${mapCopy(7)} ${kSentence(2)}`);
  });

  it("omits the sentence entirely when every key has a strategy", async () => {
    setFixtures({
      ownRows: [
        { ...dbStrategy("s-1", "Nebula One", "private"), api_key_id: "k-1" },
      ],
      population: Array.from({ length: 7 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
      apiKeys: [activeKey("k-1", "bybit", "Bybit Main")],
    });

    await renderPage();

    const note = screen.getByTestId("comparison-set-note");
    expect(note.textContent).not.toContain("of your keys have no strategy yet");
    expect(note.textContent).toBe(mapCopy(7));
  });
});

describe("page branches — empty vs placeholders-only", () => {
  it("zero strategies AND zero bare keys renders the page-level empty state, with NO comparison line", async () => {
    setFixtures({
      ownRows: [],
      population: Array.from({ length: 7 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
      apiKeys: [],
    });

    await renderPage();

    expect(screen.getByText(EMPTY_HEADING)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_BODY)).toBeInTheDocument();
    // A ranking line above an empty panel is noise (UI-SPEC States table).
    expect(screen.queryByTestId("comparison-set-note")).toBeNull();
    // The CTA is a BUTTON (it opens the wizard overlay); a Link into the
    // manager-guarded /strategies subtree would redirect-bounce the allocator.
    const cta = screen.getByRole("button", { name: "Add a Strategy" });
    expect(cta.tagName).toBe("BUTTON");
  });

  it("zero strategies but bare keys present renders the table section, noted with ONLY the K sentence", async () => {
    setFixtures({
      ownRows: [],
      population: Array.from({ length: 7 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
      apiKeys: [
        activeKey("k-1", "bybit", "Bybit Main"),
        activeKey("k-2", "deribit", "Deribit Options"),
      ],
    });

    await renderPage();

    expect(screen.queryByText(EMPTY_HEADING)).toBeNull();
    expect(screen.getByTestId("comparison-set-note").textContent).toBe(
      kSentence(2),
    );
    // Server-formatted exchange labels reach the placeholder rows (the table
    // renders `exchangeLabel` verbatim — it never owns exchange naming).
    expect(screen.getByText(/Bybit · Bybit Main/)).toBeInTheDocument();
    expect(screen.getByText(/Deribit · Deribit Options/)).toBeInTheDocument();
    // No published-universe fetch is worth making with zero own rows to score.
    expect(recorded.filter(isPopulationShape)).toHaveLength(0);
  });
});

describe("WR-01 — fetch error renders the unavailable notice, NEVER the empty state", () => {
  // 149 review WR-01 regression. Before the fix, both owner fetchers
  // fail-softed to `[]`, so a transient DB failure rendered the DEFINITIVE
  // "No strategies yet." panel + Add-a-Strategy CTA to an owner who HAS
  // strategies. Error and empty are distinct states: null = fetch failed →
  // notice; [] = empty success → empty state. Each spec below goes RED on
  // the pre-fix `return []` arms.
  const NOTICE = /My Strategies temporarily unavailable/;

  it("a failed own-rows read renders ONLY the notice — not the empty panel or its CTA", async () => {
    setFixtures({
      // The owner HAS a strategy; the read for it fails. Rendering the empty
      // state here is the account-state lie this fix removes.
      ownRows: [dbStrategy("s-1", "Nebula One", "private")],
      population: Array.from({ length: 7 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
      apiKeys: [],
      errors: { ownRows: true },
    });

    await renderPage();

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_HEADING)).toBeNull();
    expect(screen.queryByText(EMPTY_BODY)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add a Strategy" }),
    ).toBeNull();
    // No table section either: nothing loaded, so there is nothing honest to
    // rank — the notice is the whole degraded surface.
    expect(screen.queryByTestId("comparison-set-note")).toBeNull();
  });

  it("a failed keys read keeps the rows that DID load under the notice (no silent placeholder vanish)", async () => {
    setFixtures({
      ownRows: [dbStrategy("s-1", "Nebula One", "private")],
      population: Array.from({ length: 7 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
      apiKeys: [activeKey("k-1", "bybit", "Bybit Main")],
      errors: { apiKeys: true },
    });

    await renderPage();

    // The discovery watchlist-banner pattern: partial degradation is DECLARED,
    // while the successful fetch still renders in full.
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_HEADING)).toBeNull();
    expect(screen.getByTestId("comparison-set-note").textContent).toBe(
      mapCopy(7),
    );
  });

  it("genuine empty-success still renders the empty state, with NO notice (the states stay distinct both ways)", async () => {
    setFixtures({ ownRows: [], population: [], apiKeys: [] });

    await renderPage();

    expect(screen.getByText(EMPTY_HEADING)).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});

describe("page wiring", () => {
  it("opts out of the response cache and gates the surface on the allocator role", async () => {
    setFixtures({
      ownRows: [dbStrategy("s-1", "Nebula One", "private")],
      population: Array.from({ length: 7 }, (_, i) =>
        populationRow(`p-${i}`, i + 1),
      ),
    });

    await renderPage();

    // T-149-12: owner-rendered HTML must never be cached across users.
    expect(noStoreSpy).toHaveBeenCalled();
    expect(requireRoleSpy).toHaveBeenCalledTimes(1);
    expect(requireRoleSpy.mock.calls[0][2]).toBe("allocator");
    expect(requireRoleSpy.mock.calls[0][1]).toEqual(MOCK_USER);
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});
